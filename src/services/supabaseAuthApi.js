// Supabase Auth + Postgres. Only the managed Supabase auth session is persisted.
// The user's password, derived authSecret, key-encryption key and unwrapped keys are not.
import { ApiError } from "./apiClient.js";
import { ERROR_CODES } from "./contract.js";
import { getSupabase } from "./supabaseClient.js";

function toApiError(error, fallback = "Something went wrong. Please try again.") {
  const status = error?.status ?? 0;
  const code = error?.code ?? "";
  const message = String(error?.message ?? "");

  if (error?.name === "AuthRetryableFetchError" || /failed to fetch|network/i.test(message)) {
    return new ApiError(ERROR_CODES.NETWORK_ERROR, "Could not reach the server. Check your connection and try again.");
  }
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return new ApiError(ERROR_CODES.INVALID_CREDENTIALS, "Incorrect email or password.", 400);
  }
  if (code === "user_already_exists" || /already registered/i.test(message)) {
    return new ApiError(ERROR_CODES.EMAIL_TAKEN, "An account with this email already exists.", 409);
  }
  if (code === "email_not_confirmed") {
    return new ApiError(ERROR_CODES.EMAIL_NOT_CONFIRMED, "Confirm your email address first, then sign in.", 400);
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return new ApiError(ERROR_CODES.UNKNOWN, "Too many attempts. Wait a minute and try again.", 429);
  }
  console.error("[supabase]", error);
  return new ApiError(ERROR_CODES.UNKNOWN, fallback, status);
}

/** Restore identity only; the vault remains locked until the user enters their password. */
export async function getCurrentSession() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw toApiError(error);
  const user = data?.session?.user;
  if (!user?.id || !user?.email) return null;
  return { userId: user.id, email: user.email };
}

export async function getAuthParams(email) {
  const { data, error } = await getSupabase().rpc("get_auth_params", { p_email: email });
  if (error) throw toApiError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.kdf_salt !== "string" || !Number.isInteger(row.kdf_iterations)) {
    throw new ApiError(ERROR_CODES.UNKNOWN, "The server sent an unexpected response.");
  }
  return { kdfSalt: row.kdf_salt, kdfIterations: row.kdf_iterations };
}

export async function register(payload) {
  const supabase = getSupabase();
  const { email, displayName, authSecret, kdfSalt, kdfIterations, publicKey, wrappedPrivateKey } = payload;
  const { data, error } = await supabase.auth.signUp({
    email,
    password: authSecret,
    options: { data: {
      name: displayName,
      kdf_salt: kdfSalt,
      kdf_iterations: kdfIterations,
      public_key: publicKey,
      wrapped_private_key: wrappedPrivateKey,
    } },
  });
  if (error) throw toApiError(error, "Could not create the account. Please try again.");
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new ApiError(ERROR_CODES.EMAIL_TAKEN, "An account with this email already exists.", 409);
  }

  let session = data.session;
  if (!session) {
    const signedIn = await supabase.auth.signInWithPassword({ email, password: authSecret });
    if (signedIn.error) {
      throw new ApiError(ERROR_CODES.EMAIL_NOT_CONFIRMED, "Your account was created. Confirm your email address, then sign in.", 400);
    }
    session = signedIn.data.session;
  }
  return { userId: session.user.id, sessionToken: session.access_token };
}

export async function login({ email, authSecret }) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: authSecret });
  if (error) throw toApiError(error);

  const { session } = data;
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("name, salt, wrapped_private_key")
    .eq("user_id", session.user.id)
    .single();
  if (profileError) throw toApiError(profileError);

  return {
    userId: session.user.id,
    sessionToken: session.access_token,
    kdfSalt: profile.salt,
    wrappedPrivateKey: profile.wrapped_private_key,
    displayName: profile.name,
  };
}

export async function logout() {
  await getSupabase().auth.signOut({ scope: "local" });
}
