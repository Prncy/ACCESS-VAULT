import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InactivityGuard from '../src/components/InactivityGuard.jsx';

const MIN = 60 * 1000;

describe('InactivityGuard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('signs the user out after 15 minutes without activity', () => {
    const onSignOut = vi.fn();
    render(<InactivityGuard onSignOut={onSignOut} />);
    act(() => { vi.advanceTimersByTime(14 * MIN); });
    expect(onSignOut).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(MIN + 2000); });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('warns in the last minute, and activity resets the timer', () => {
    const onSignOut = vi.fn();
    render(<InactivityGuard onSignOut={onSignOut} />);
    act(() => { vi.advanceTimersByTime(14.5 * MIN); });
    expect(screen.getByRole('alertdialog', { hidden: true }) ?? document.body).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('keydown')); });
    act(() => { vi.advanceTimersByTime(2 * MIN); });
    expect(onSignOut).not.toHaveBeenCalled();
  });
});
