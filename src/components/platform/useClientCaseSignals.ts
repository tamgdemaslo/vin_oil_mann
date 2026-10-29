"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signalDue, signalNotes, type CaseSignalKind } from "@/lib/client-case-signal-policy";

type Alert = { id: string; title: string; body?: string; href: string };
type Snapshot = { notifications?: Array<Alert & { urgency: string; caseId: string; sentAt?: string }>; newCases?: Alert[] };

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* In-memory browser controls still work. */ }
}

/** One audible alert per browser/device, independent of the employee's other devices. */
export function useClientCaseSignals(scope: string) {
  const audio = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const lastMemory = useRef(new Map<string, number>());
  const preference = `eco-crm-signals:${scope}`;

  useEffect(() => {
    setEnabled(false);
    setMessage("");
    lastMemory.current.clear();
    // Each page must unlock audio through a user gesture, even with a saved preference.
    const unlock = () => {
      if (read(preference) !== "on") return;
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume().then(() => setEnabled(audio.current?.state === "running")).catch(() => undefined);
      } catch { /* The explicit button explains unsupported/blocked audio. */ }
    };
    const sync = (event: StorageEvent) => {
      if (event.key === preference) setEnabled(read(preference) === "on" && audio.current?.state === "running");
    };
    window.addEventListener("storage", sync);
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [preference]);

  const play = useCallback((kind: CaseSignalKind) => {
    const context = audio.current;
    if (!context || context.state !== "running" || read(preference) !== "on") return false;
    for (const note of signalNotes(kind)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "new" ? "sine" : "triangle";
      oscillator.frequency.value = note.frequency;
      const at = context.currentTime + note.at;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(kind === "new" ? 0.12 : 0.2, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + note.duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(at); oscillator.stop(at + note.duration + 0.02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
    return true;
  }, [preference]);

  const toggle = useCallback(async () => {
    if (enabled) {
      write(preference, "off"); setEnabled(false); setMessage("Сигналы выключены на этом устройстве"); return;
    }
    try {
      audio.current ??= new AudioContext();
      // Call both permission APIs directly from the click, before yielding.
      const resume = audio.current.resume();
      const permission = "Notification" in window && Notification.permission === "default"
        ? Notification.requestPermission() : Promise.resolve("Notification" in window ? Notification.permission : "denied");
      await resume;
      if (audio.current.state !== "running") throw new Error("Звук заблокирован браузером");
      write(preference, "on"); write("eco-crm-browser-push", "on"); setEnabled(true); play("new");
      const granted = await permission;
      if (granted === "granted" && "serviceWorker" in navigator) {
        await navigator.serviceWorker.register("/crm-notifications-sw.js");
      }
      setMessage(granted === "granted" ? "Звук и уведомления включены" : "Звук включён. Уведомления разрешите в настройках браузера");
    } catch {
      setMessage("Не удалось включить сигналы. Проверьте разрешения браузера и попробуйте ещё раз");
    }
  }, [enabled, preference, play]);

  const process = useCallback(async (snapshot: Snapshot) => {
    if (read(preference) === "off") return;
    const newest = snapshot.newCases?.[0];
    const overdue = snapshot.notifications?.find(item => item.urgency === "overdue");
    const deliver = async (kind: CaseSignalKind | "reminder", alert: Alert, eventId: string) => {
      const now = Date.now();
      const soundKey = `${preference}:sound:${eventId}`;
      const pushKey = `${preference}:push:${eventId}`;
      const getLast = (key: string) => {
        const value = read(key);
        return value === null ? lastMemory.current.get(key) ?? null : Number(value);
      };
      const due = (key: string) => kind === "overdue" ? signalDue(getLast(key), now) : getLast(key) === null;
      if (kind !== "reminder" && due(soundKey) && play(kind)) {
        write(soundKey, String(now)); lastMemory.current.set(soundKey, now);
      }
      if (read("eco-crm-browser-push") === "off" || !("Notification" in window) || Notification.permission !== "granted" || !due(pushKey)) return;
      try {
        const title = kind === "new" ? "Новая заявка клиента" : alert.title;
        const options = { body: alert.body || alert.title, tag: `crm-${eventId}`, data: { href: alert.href }, requireInteraction: kind === "overdue", silent: true };
        const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/crm-notifications-sw.js") : null;
        if (registration?.active && registration.active.scriptURL.endsWith("/crm-notifications-sw.js")) await registration.showNotification(title, options);
        else {
          const notification = new Notification(title, options);
          notification.onclick = () => { window.focus(); window.location.assign(alert.href); notification.close(); };
        }
        write(pushKey, String(now)); lastMemory.current.set(pushKey, now);
      } catch { setMessage("Системные уведомления недоступны. Проверьте разрешения браузера"); }
    };
    const work = async () => {
      if (newest) await deliver("new", newest, `new:${newest.id}`);
      if (overdue) await deliver("overdue", overdue, "overdue");
      const reminder = snapshot.notifications?.find(item => item.urgency !== "overdue");
      if (reminder) await deliver("reminder", reminder, `reminder:${reminder.id}:${reminder.sentAt ?? ""}`);
    };
    if (navigator.locks) await navigator.locks.request(`${preference}:delivery`, work);
    else await work();
  }, [preference, play]);

  return { enabled, message, toggle, process };
}
