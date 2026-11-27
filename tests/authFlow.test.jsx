import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { __resetMockAuth, __setMockLatency, DEMO_USER } from '../src/services/mock/mockAuthApi.js';

function renderApp(route = '/login') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.setConfig({ testTimeout: 30000 });
  __resetMockAuth();
  __setMockLatency(0);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Login screen', () => {
  it('shows field errors and does not submit empty input', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/Enter your email/)).toBeInTheDocument();
    expect(screen.getByText(/Enter your password/)).toBeInTheDocument();
  });

  it('signs in with the demo account and reaches the vault', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('Email'), DEMO_USER.email);
    await user.type(screen.getByLabelText('Password'), DEMO_USER.password);
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/No folders in this location yet/)).toBeInTheDocument();
  });

  it('shows one generic error for a wrong password', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('Email'), DEMO_USER.email);
    await user.type(screen.getByLabelText('Password'), 'not the password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('protects /vault when signed out', () => {
    renderApp('/vault');
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });
});

async function signInDemo(user) {
  await user.type(screen.getByLabelText('Email'), DEMO_USER.email);
  await user.type(screen.getByLabelText('Password'), DEMO_USER.password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
  await screen.findByText(/No folders in this location yet/);
}

async function createFolder(user, name) {
  await user.click(screen.getByRole('button', { name: /create a new folder/i }));
  await user.type(screen.getByLabelText('Folder name'), name);
  await user.click(screen.getByRole('button', { name: 'Create' }));
}

describe('Folder explorer', () => {
  it('creates a folder, opens it, and creates one inside', async () => {
    const user = userEvent.setup();
    renderApp();
    await signInDemo(user);

    await createFolder(user, 'Notes');
    await user.click(await screen.findByRole('button', { name: 'Open Notes' }));
    await createFolder(user, 'Week 1');
    expect(await screen.findByRole('button', { name: 'Open Week 1' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /folder path/i })).toHaveTextContent('Notes');
  });

  it('uploads an encrypted file, lists it, and downloads it back', async () => {
    const user = userEvent.setup();
    const saved = [];
    URL.createObjectURL = vi.fn((blob) => { saved.push(blob); return 'blob:test'; });
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();

    renderApp();
    await signInDemo(user);
    await createFolder(user, 'Docs');
    await user.click(await screen.findByRole('button', { name: 'Open Docs' }));

    await user.upload(screen.getByLabelText('Upload files to this folder'), new File(['hello vault'], 'hello.txt', { type: 'text/plain' }));
    await user.click(await screen.findByLabelText('More actions for hello.txt'));
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].size).toBe('hello vault'.length);

    await user.click(screen.getByLabelText('More actions for hello.txt'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByLabelText('More actions for hello.txt')).not.toBeInTheDocument());
  });

  it('shares a folder from the UI with a fingerprint check, then revokes it', async () => {
    const user = userEvent.setup();
    // A second account to share with (made through the same flow the app uses).
    const authFlow = await import('../src/services/authFlow.js');
    await authFlow.register('bob@test.co', 'Bob', 'bob-long-password-1');
    await authFlow.logout();

    renderApp();
    await signInDemo(user);
    await createFolder(user, 'Reports');

    await user.click(await screen.findByRole('button', { name: 'Share Reports' }));
    await user.type(screen.getByLabelText('Their email'), 'bob@test.co');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByLabelText('Key fingerprint')).toHaveTextContent(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);

    await user.selectOptions(screen.getByLabelText('Access ends'), '7');
    await user.click(screen.getByRole('button', { name: 'Share read-only' }));
    const list = await screen.findByRole('list', { name: 'Shared with' });
    expect(list).toHaveTextContent('Bob');
    expect(list).toHaveTextContent('until');

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Nobody yet.')).toBeInTheDocument();
  });

  it('shows a friendly message for an empty name', async () => {
    const user = userEvent.setup();
    renderApp();
    await signInDemo(user);
    await user.click(screen.getByRole('button', { name: /create a new folder/i }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Enter a folder name/);
  });
});

describe('Register screen', () => {
  it('blocks mismatched passwords', async () => {
    const user = userEvent.setup();
    renderApp('/register');
    await user.type(screen.getByLabelText('Your name'), 'Dalitso');
    await user.type(screen.getByLabelText('Email'), 'new@user.co');
    await user.type(screen.getByLabelText('Password'), 'a-long-test-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-different-password');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/do not match/)).toBeInTheDocument();
  });

  it('creates an account, lands in the vault, and can sign out and back in', async () => {
    const user = userEvent.setup();
    renderApp('/register');
    await user.type(screen.getByLabelText('Your name'), 'Dalitso');
    await user.type(screen.getByLabelText('Email'), 'new@user.co');
    await user.type(screen.getByLabelText('Password'), 'a-long-test-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-long-test-password');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/Your account is ready/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByText(/You have been signed out/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'new@user.co');
    await user.type(screen.getByLabelText('Password'), 'a-long-test-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/No folders in this location yet/)).toBeInTheDocument());
  });

  it('shows email_taken on the email field', async () => {
    const user = userEvent.setup();
    renderApp('/register');
    await user.type(screen.getByLabelText('Your name'), 'Someone');
    await user.type(screen.getByLabelText('Email'), DEMO_USER.email);
    await user.type(screen.getByLabelText('Password'), 'a-long-test-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-long-test-password');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });
});
