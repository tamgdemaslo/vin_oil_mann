"use client";

import { useState } from "react";

const FOUR_DIGIT_PASSWORD_PATTERN = /^\d{4}$/;

function toFourDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

export default function PasswordChangeCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Заполните все поля");
      return;
    }

    if (!FOUR_DIGIT_PASSWORD_PATTERN.test(newPassword)) {
      setError("Новый пароль должен состоять ровно из 4 цифр");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Новый пароль и подтверждение не совпадают");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось поменять пароль");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Пароль обновлен");
    } catch {
      setError("Ошибка соединения");
    } finally {
      setSaving(false);
    }
  }

  const inputClassName =
    "mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 dark:border-zinc-600 dark:bg-zinc-800";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Текущий пароль
          </label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={inputClassName}
            autoComplete="current-password"
            disabled={saving}
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Новый пароль
          </label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(toFourDigits(event.target.value))}
            className={inputClassName}
            autoComplete="new-password"
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]{4}"
            disabled={saving}
          />
        </div>
        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Повторите пароль
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(toFourDigits(event.target.value))}
            className={inputClassName}
            autoComplete="new-password"
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]{4}"
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {saving ? "Сохраняем…" : "Сменить пароль"}
        </button>
        {message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{message}</span>}
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </form>
  );
}
