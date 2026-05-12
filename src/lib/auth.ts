import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/db";

const SESSION_COOKIE = "eco_session";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "eco-platform-secret-change-in-production";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const AUTH_SALT = process.env.AUTH_SALT ?? "eco-salt";
const DEFAULT_AUTH_USERS =
  "ilya:1111:Илья:owner,denis:2222:Денис:owner,alexandr:3333:Вадим:admin,maksim:4444:Максим:master";

export type UserRole = "owner" | "admin" | "master";

export type User = {
  login: string;
  name: string;
  role: UserRole;
};

type SessionPayload = {
  login: string;
  name: string;
  role?: string;
  exp: number; // unix seconds
};

function hashPassword(password: string, salt: string): string {
  return crypto.createHash("sha256").update(salt + password, "utf8").digest("hex");
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(data: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(data, "utf8").digest("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function normalizeRole(value?: string): UserRole {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return "admin";
  if (v === "owner" || v === "владелец") return "owner";
  if (v === "master" || v === "мастер") return "master";
  if (v === "admin" || v === "админ" || v === "administrator" || v === "администратор") return "admin";
  return "admin";
}

type EnvUser = { login: string; name: string; passwordHash: string; role: UserRole };

async function getPasswordOverrides(): Promise<Map<string, string>> {
  try {
    const rows = await prisma.authPassword.findMany();
    return new Map(rows.map((row) => [row.login.trim().toLowerCase(), row.passwordHash]));
  } catch {
    return new Map();
  }
}

export async function getUsersFromEnv(): Promise<EnvUser[]> {
  const raw = process.env.AUTH_USERS?.trim() || DEFAULT_AUTH_USERS;
  if (!raw?.trim()) return [];
  const lines = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const passwordOverrides = await getPasswordOverrides();
  const users: EnvUser[] = [];
  for (const line of lines) {
    const parts = line.split(":");
    if (parts.length >= 2) {
      const [rawLogin, rawPassword, rawName, rawRole] = parts;
      const login = (rawLogin ?? "").trim();
      const password = (rawPassword ?? "").trim();
      const name = (rawName ?? "").trim() || login;
      if (login && password) {
        const role = normalizeRole(rawRole);
        users.push({
          login,
          name,
          role,
          passwordHash: passwordOverrides.get(login.toLowerCase()) ?? hashPassword(password, AUTH_SALT),
        });
      }
    }
  }
  return users;
}

export async function getPublicUsers(): Promise<User[]> {
  const users = await getUsersFromEnv();
  return users.map(({ login, name, role }) => ({ login, name, role }));
}

export async function verifyUser(login: string, password: string): Promise<User | null> {
  const users = await getUsersFromEnv();
  const hash = hashPassword(password, AUTH_SALT);
  const u = users.find((x) => x.login === login && x.passwordHash === hash);
  return u ? { login: u.login, name: u.name, role: u.role } : null;
}

export async function setUserPassword(login: string, password: string): Promise<void> {
  await prisma.authPassword.upsert({
    where: { login },
    update: { passwordHash: hashPassword(password, AUTH_SALT) },
    create: { login, passwordHash: hashPassword(password, AUTH_SALT) },
  });
}

export async function getSession(): Promise<{ user: User } | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64);
  if (!timingSafeEqual(expected, sig)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64)) as SessionPayload;
  } catch {
    return null;
  }
  if (!payload?.login || !payload?.name || typeof payload.exp !== "number") return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  const role = normalizeRole(payload.role);
  return { user: { login: payload.login, name: payload.name, role } };
}

export async function createSession(user: User): Promise<string> {
  const payload: SessionPayload = {
    login: user.login,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function getSessionCookieOpts() {
  return {
    name: SESSION_COOKIE,
    maxAge: SESSION_MAX_AGE,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };
}

export async function clearSession(token: string): Promise<void> {
  void token;
}
