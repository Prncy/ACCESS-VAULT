// Encrypted files. Pages call THESE functions and never see a key.
//
//   pages -> fileFlow.js (keys, chunking, encryption) -> backend (mock or Supabase)
//
// Per Chapter 4 / Algorithm 4.2:
//   file key      random AES-256-GCM key per file, stored wrapped under the FOLDER key (files.wrapped_file_key)
//   file name     encrypted with the file key (files.name_enc); the database never sees name or type
//   content       cut into chunks, each encrypted with nonce = baseNonce || index and AAD = fileId || index || isLast,
//                 so reordering, dropping or truncating chunks makes decryption fail
// The browser picks the fileId because it is part of every chunk's AAD.

import { getBackend } from "./authFlow.js";
import { getFolderKey, getVaultFolderId } from "./folderFlow.js";
import { ApiError } from "./apiClient.js";
import { ERROR_CODES } from "./contract.js";
import {
  generateAesKey,
  encryptChunk,
  decryptChunk,
  encryptMetadata,
  decryptMetadata,
} from "../crypto/cryptoEngine.js";
import { wrapKey, unwrapKey } from "../crypto/keyManager.js";
import {
  base64ToBuf,
  bufToBase64,
  concatBytes,
  packBlob,
  unpackBlob,
  uint32BE,
} from "../crypto/encoding.js";

export const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB of plaintext (+16-byte tag) fits the bucket's 5,243,904-byte limit
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // files.size check in the database
export const FILE_NAME_MAX = 255;

const AES = { name: "AES-GCM" };
const USAGES = ["encrypt", "decrypt"];

export function cleanFileName(raw) {
  const name = String(raw ?? "").trim();
  if (!name)
    throw new ApiError(
      ERROR_CODES.INVALID_REQUEST,
      "This file has no name.",
      400,
    );
  if (name.length > FILE_NAME_MAX)
    throw new ApiError(
      ERROR_CODES.INVALID_REQUEST,
      `File names can be at most ${FILE_NAME_MAX} characters.`,
      400,
    );
  if (/[\\/]/.test(name))
    throw new ApiError(
      ERROR_CODES.INVALID_REQUEST,
      "File names cannot contain / or \\.",
      400,
    );
  return name;
}

/** Reads a Blob/File slice into bytes (uses arrayBuffer() when the runtime has it, FileReader otherwise). */
function readBytes(blob) {
  if (typeof blob.arrayBuffer === "function")
    return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const hex = (buf) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
const chunkIvB64 = (baseNonce, index) =>
  bufToBase64(concatBytes(baseNonce, uint32BE(index)));

async function unwrapFileKey(row, folderKey) {
  const wrapped = unpackBlob(row.wrappedFileKey);
  return unwrapKey(
    wrapped.ciphertext,
    wrapped.iv,
    folderKey,
    AES,
    true,
    USAGES,
  );
}

async function readName(row, fileKey) {
  const { iv, ciphertext } = unpackBlob(row.nameEnc);
  return decryptMetadata(fileKey, iv, ciphertext);
}

/**
 * Encrypts and uploads `file` (a File/Blob with a name) into the folder `folderId`.
 * options.onProgress(done, total) is called after each chunk; options.chunkSize is for tests.
 * Returns { id, folderId, name, size }.
 */
export async function uploadFile(
  file,
  folderId,
  { onProgress, chunkSize = CHUNK_SIZE } = {},
) {
  const name = cleanFileName(file?.name);
  const size = file.size;
  if (size > MAX_FILE_BYTES) {
    throw new ApiError(
      ERROR_CODES.INVALID_REQUEST,
      `Files can be at most ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
      400,
    );
  }

  const vaultId = await getVaultFolderId();
  if (folderId === vaultId) {
    throw new ApiError(ERROR_CODES.INVALID_REQUEST, "Open or create a folder before uploading files.", 400);
  }
  const backend = getBackend();
  const folderKey = await getFolderKey(folderId);

  const fileId = crypto.randomUUID();
  const fileKey = await generateAesKey();
  const baseNonce = crypto.getRandomValues(new Uint8Array(8));
  const chunkCount = Math.max(1, Math.ceil(size / chunkSize)); // an empty file is one empty chunk

  const wrapped = await wrapKey(fileKey, folderKey);
  const nameBlob = await encryptMetadata(fileKey, name);

  await backend.createFile({
    fileId,
    folderId,
    nameEnc: packBlob(nameBlob.iv, nameBlob.ciphertext),
    size,
    chunkCount,
    wrappedFileKey: packBlob(wrapped.iv, wrapped.wrapped),
    baseNonce: bufToBase64(baseNonce),
  });

  try {
    for (let index = 0; index < chunkCount; index++) {
      const plaintext = await readBytes(
        file.slice(index * chunkSize, Math.min(size, (index + 1) * chunkSize)),
      );
      const isLast = index === chunkCount - 1;
      const ciphertext = new Uint8Array(
        await encryptChunk(
          fileKey,
          baseNonce,
          fileId,
          index,
          isLast,
          plaintext,
        ),
      );
      await backend.uploadChunk({
        fileId,
        index,
        bytes: ciphertext,
        iv: chunkIvB64(baseNonce, index),
        checksum: hex(await crypto.subtle.digest("SHA-256", ciphertext)),
      });
      onProgress?.(index + 1, chunkCount);
    }
    await backend.completeFile(fileId);
  } catch (err) {
    // Don't leave a half-finished upload behind. Best effort: the original error is the one that matters.
    await backend.deleteFile(fileId).catch(() => {});
    throw err;
  }
  return { id: fileId, folderId, name, size };
}

/** Files in a folder, with decrypted names: [{ id, folderId, name, size, createdAt }]. A file that cannot be decrypted is left out. */
export async function listFiles(folderId) {
  const folderKey = await getFolderKey(folderId);
  const rows = await getBackend().listFiles(folderId);
  const out = [];
  for (const row of rows) {
    try {
      const fileKey = await unwrapFileKey(row, folderKey);
      out.push({
        id: row.id,
        folderId,
        name: await readName(row, fileKey),
        size: row.size,
        createdAt: row.createdAt,
      });
    } catch {
      console.error(
        "[fileFlow] skipped a file that could not be decrypted",
        row.id,
      );
    }
  }
  return out;
}

/**
 * Downloads, authenticates and decrypts every chunk. Returns { name, blob }.
 * Any chunk that fails its authentication tag aborts the whole download (Chapter 4.4.2.5).
 */
export async function downloadFile(
  fileId,
  folderId,
  { onProgress, parallelChunks = 2 } = {},
) {
  const backend = getBackend();
  onProgress?.({ stage: "preparing", bytesDone: 0, totalBytes: 0, chunksDone: 0, totalChunks: 0 });
  const row = await backend.getFile(fileId);
  if (!row)
    throw new ApiError(
      ERROR_CODES.INVALID_REQUEST,
      "That file could not be found.",
      404,
    );

  const folderKey = await getFolderKey(folderId ?? row.folderId);
  let fileKey;
  let name;
  try {
    fileKey = await unwrapFileKey(row, folderKey);
    name = await readName(row, fileKey);
  } catch {
    throw new ApiError(
      ERROR_CODES.UNKNOWN,
      "This file is corrupted or has been tampered with.",
      0,
    );
  }

  const totalChunks = row.chunkCount;
  const totalBytes = row.size;
  const concurrency = Math.max(1, Math.min(3, Math.floor(parallelChunks) || 1));
  const encryptedParts = new Array(totalChunks);
  let bytesDone = 0;
  let chunksDone = 0;

  // Fetch a small batch concurrently, then retain the original order for authenticated decryption.
  for (let start = 0; start < totalChunks; start += concurrency) {
    const indexes = Array.from(
      { length: Math.min(concurrency, totalChunks - start) },
      (_, offset) => start + offset,
    );
    const batch = await Promise.all(
      indexes.map((index) => backend.downloadChunk({ fileId, index })),
    );
    batch.forEach((encrypted, offset) => {
      const index = indexes[offset];
      encryptedParts[index] = encrypted;
      bytesDone += Math.min(
        CHUNK_SIZE,
        Math.max(0, totalBytes - index * CHUNK_SIZE),
      );
      chunksDone += 1;
      onProgress?.({
        stage: "downloading",
        bytesDone: Math.min(bytesDone, totalBytes),
        totalBytes,
        chunksDone,
        totalChunks,
      });
    });
  }

  const baseNonce = new Uint8Array(base64ToBuf(row.baseNonce));
  const parts = [];
  let decryptedBytes = 0;
  for (let index = 0; index < totalChunks; index++) {
    try {
      const plaintext = new Uint8Array(
        await decryptChunk(
          fileKey,
          baseNonce,
          fileId,
          index,
          index === totalChunks - 1,
          encryptedParts[index],
        ),
      );
      parts.push(plaintext);
      decryptedBytes += plaintext.byteLength;
      onProgress?.({
        stage: "decrypting",
        bytesDone: Math.min(decryptedBytes, totalBytes),
        totalBytes,
        chunksDone: index + 1,
        totalChunks,
      });
    } catch {
      throw new ApiError(
        ERROR_CODES.UNKNOWN,
        "This file is corrupted or has been tampered with, so it was not downloaded.",
        0,
      );
    }
  }
  // Only record a download after every chunk has passed authenticated decryption.
  try {
    const { logAuditEvent } = await import('./auditService.js');
    await logAuditEvent('DOWNLOAD', fileId, 'file');
  } catch (err) {
    console.warn('[audit] DOWNLOAD event could not be recorded', err);
  }
  return { name, blob: new Blob(parts, { type: "application/octet-stream" }) };
}

export async function deleteFile(fileId) {
  await getBackend().deleteFile(fileId);
}
