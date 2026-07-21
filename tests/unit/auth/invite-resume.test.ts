// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  clearInviteResumeCookie,
  createInviteResumeCookie,
  INVITE_RESUME_COOKIE_POLICY_V1,
  readInviteResumeToken,
  type InviteResumeKey,
  writeInviteResumeCookie,
} from "@/lib/auth/invite-resume";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const TOKEN = "A".repeat(43);
const KEY = inviteResumeKey(17);

describe("sealed invitation resume cookie", () => {
  it("round-trips an opaque token only inside its short lifetime", () => {
    const cookie = createInviteResumeCookie(
      { token: TOKEN, now: NOW, secure: false },
      KEY,
    );

    expect(cookie.value).not.toContain(TOKEN);
    expect(readInviteResumeToken(cookie.value, NOW, KEY)).toBe(TOKEN);
    expect(
      readInviteResumeToken(
        cookie.value,
        new Date(
          NOW.getTime() +
            INVITE_RESUME_COOKIE_POLICY_V1.ttlMilliseconds -
            1,
        ),
        KEY,
      ),
    ).toBe(TOKEN);
    expect(
      readInviteResumeToken(
        cookie.value,
        new Date(
          NOW.getTime() + INVITE_RESUME_COOKIE_POLICY_V1.ttlMilliseconds,
        ),
        KEY,
      ),
    ).toBeNull();
  });

  it("fails closed for ciphertext, authentication tag, key and clock tampering", () => {
    const cookie = createInviteResumeCookie(
      { token: TOKEN, now: NOW, secure: true },
      KEY,
    );
    const [version, nonce, ciphertext, authTag] = cookie.value.split(".") as [
      string,
      string,
      string,
      string,
    ];
    const changedCiphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    const changedTag = `${authTag[0] === "A" ? "B" : "A"}${authTag.slice(1)}`;

    expect(
      readInviteResumeToken(
        [version, nonce, changedCiphertext, authTag].join("."),
        NOW,
        KEY,
      ),
    ).toBeNull();
    expect(
      readInviteResumeToken(
        [version, nonce, ciphertext, changedTag].join("."),
        NOW,
        KEY,
      ),
    ).toBeNull();
    expect(readInviteResumeToken(cookie.value, NOW, inviteResumeKey(18))).toBeNull();
    expect(
      readInviteResumeToken(
        cookie.value,
        new Date(
          NOW.getTime() -
            INVITE_RESUME_COOKIE_POLICY_V1.clockSkewMilliseconds -
            1,
        ),
        KEY,
      ),
    ).toBeNull();
    expect(readInviteResumeToken("malformed", NOW, KEY)).toBeNull();
  });

  it("uses narrow HttpOnly Lax cookies and clears the same cookie scope", () => {
    const set = vi.fn();
    const writer = { set };
    const cookie = createInviteResumeCookie(
      { token: TOKEN, now: NOW, secure: true },
      KEY,
    );

    writeInviteResumeCookie(writer, cookie);
    clearInviteResumeCookie(writer, true);

    expect(set).toHaveBeenNthCalledWith(
      1,
      "invite_resume",
      cookie.value,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/invite",
        maxAge: 1_800,
      }),
    );
    expect(set).toHaveBeenNthCalledWith(2, "invite_resume", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/invite",
      expires: new Date(0),
      maxAge: 0,
    });
  });

  it("rejects malformed inputs before creating a cookie", () => {
    expect(() =>
      createInviteResumeCookie(
        { token: "short", now: NOW, secure: false },
        KEY,
      ),
    ).toThrow();
    expect(() =>
      createInviteResumeCookie(
        { token: TOKEN, now: new Date(Number.NaN), secure: false },
        KEY,
      ),
    ).toThrow();
  });
});

function inviteResumeKey(fill: number): InviteResumeKey {
  return Object.freeze({
    withValue<TResult>(consumer: (value: string) => TResult): TResult {
      return consumer(Buffer.alloc(32, fill).toString("base64"));
    },
  });
}
