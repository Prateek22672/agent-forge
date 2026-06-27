import { api } from "./api";

// Subscribe this device to push notifications. Must be called from a user
// gesture (required on iOS). Returns true if subscribed.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "Push isn't supported on this browser." };
  }
  const { key, enabled } = await api.vapidPublicKey();
  if (!enabled || !key) {
    return { ok: false, reason: "Push isn't configured on the server yet." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Notifications permission was denied." };
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await api.pushSubscribe(sub.toJSON());
  return { ok: true };
}

export function pushPermissionState() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission; // default | granted | denied
}
