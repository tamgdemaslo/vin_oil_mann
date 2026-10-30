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
  const pendingSounds = useRef(new Map<string, CaseSignalKind>());
  const retrySounds = useRef<() => Promise<void>>(async () => {});
  const clips = useRef<Partial<Record<CaseSignalKind, AudioBuffer>>>({});
  const nextSoundAt = useRef(0);
  const preference = `eco-crm-signals:${scope}`;

  useEffect(() => {
    setEnabled(false);
    setMessage("");
    lastMemory.current.clear();
    pendingSounds.current.clear();
    // Sound is mandatory; autoplay is attempted first, then any ordinary interaction unlocks it.
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume().then(() => {
          const ready = audio.current?.state === "running";
          setEnabled(ready);
          if (ready) void retrySounds.current();
        }).catch(() => undefined);
      } catch { setMessage("Браузер блокирует звук. Проверьте разрешение автозвука для сайта"); }
    };
    unlock();
    const controller = new AbortController();
    void fetch("/audio/client-case-signals.json", { signal: controller.signal, cache: "no-cache" })
      .then(response => response.ok ? response.json() : {})
      .then(async (paths: Partial<Record<CaseSignalKind, unknown>>) => {
        await Promise.allSettled((["new", "overdue"] as const).map(async kind => {
          const path = paths[kind];
          if (typeof path !== "string" || !/^\/audio\/[a-zA-Z0-9/_-]+\.(mp3|wav|ogg|m4a)$/.test(path)) return;
          const response = await fetch(path, { signal: controller.signal });
          if (response.ok && audio.current) clips.current[kind] = await audio.current.decodeAudioData(await response.arrayBuffer());
        }));
      }).catch(() => { /* Until recordings are supplied, the built-in tones remain available. */ });
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("click", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      controller.abort();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [preference]);

  const play = useCallback((kind: CaseSignalKind) => {
    const context = audio.current;
    if (!context || context.state !== "running") return false;
    const startAt = Math.max(context.currentTime, nextSoundAt.current);
    const clip = clips.current[kind];
    if (clip) {
      const source = context.createBufferSource();
      source.buffer = clip;
      source.connect(context.destination);
      source.start(startAt);
      source.onended = () => source.disconnect();
      nextSoundAt.current = startAt + clip.duration + 0.15;
      return true;
    }
    nextSoundAt.current = startAt + (kind === "new" ? 0.6 : 1.9);
    for (const note of signalNotes(kind)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "new" ? "sine" : "triangle";
      oscillator.frequency.value = note.frequency;
      const at = startAt + note.at;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(kind === "new" ? 0.12 : 0.2, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + note.duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(at); oscillator.stop(at + note.duration + 0.02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
    return true;
  }, []);

  const requestNotifications = useCallback(async () => {
    try {
      audio.current ??= new AudioContext();
      // Call both permission APIs directly from the click, before yielding.
      const resume = audio.current.resume();
      const permission = "Notification" in window && Notification.permission === "default"
        ? Notification.requestPermission() : Promise.resolve("Notification" in window ? Notification.permission : "denied");
      await resume;
      if (audio.current.state !== "running") throw new Error("Звук заблокирован браузером");
      write("eco-crm-browser-push", "on"); setEnabled(true);
      void retrySounds.current();
      const granted = await permission;
      if (granted === "granted" && "serviceWorker" in navigator) {
        await navigator.serviceWorker.register("/crm-notifications-sw.js");
      }
      setMessage(granted === "granted" ? "Звук и уведомления включены" : "Звук включён. Уведомления разрешите в настройках браузера");
    } catch {
      setMessage("Не удалось включить сигналы. Проверьте разрешения браузера и попробуйте ещё раз");
    }
  }, []);

  const process = useCallback(async (snapshot: Snapshot) => {
    const newest = snapshot.newCases?.[0];
    const overdue = snapshot.notifications?.find(item => item.urgency === "overdue");
    if (!overdue) pendingSounds.current.delete(`${preference}:sound:overdue`);
    const deliver = async (kind: CaseSignalKind | "reminder", alert: Alert, eventId: string) => {
      const now = Date.now();
      const soundKey = `${preference}:sound:${eventId}`;
      const pushKey = `${preference}:push:${eventId}`;
      const getLast = (key: string) => {
        const value = read(key);
        return value === null ? lastMemory.current.get(key) ?? null : Number(value);
      };
      const due = (key: string) => kind === "overdue" ? signalDue(getLast(key), now) : getLast(key) === null;
      if (kind !== "reminder" && due(soundKey)) {
        if (play(kind)) {
          write(soundKey, String(now)); lastMemory.current.set(soundKey, now);
          pendingSounds.current.delete(soundKey);
        } else pendingSounds.current.set(soundKey, kind);
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

  retrySounds.current = async () => {
    const retry = async () => {
      const played = new Set<CaseSignalKind>();
      for (const [key, kind] of pendingSounds.current) {
        const stored = read(key);
        const last = stored === null ? lastMemory.current.get(key) ?? null : Number(stored);
        if (kind === "overdue" ? !signalDue(last, Date.now()) : last !== null) { pendingSounds.current.delete(key); continue; }
        if (!played.has(kind) && !play(kind)) continue;
        played.add(kind);
        const now = Date.now();
        write(key, String(now)); lastMemory.current.set(key, now);
        pendingSounds.current.delete(key);
      }
    };
    if (navigator.locks) await navigator.locks.request(`${preference}:delivery`, retry);
    else await retry();
  };

  return { enabled, message, requestNotifications, process };
}
