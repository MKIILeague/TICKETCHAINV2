// ─── Event lifecycle status — single source of truth ────────────────────────
// Firestore `events` documents carry a `status` field with one of five states.
// `finished` is DERIVED at read time from a published event whose date has
// passed, so no background job is needed.
//
//   draft     -> organiser-only; never minted; hidden from buyers
//   published -> minted on-chain; live on the marketplace
//   finished  -> published + event date in the past; archived ("Past events")
//   canceled  -> organiser emergency-cancel; visible but frozen (no buy/transfer/entry)
//   deleted   -> soft-deleted draft; hidden everywhere, kept for audit
//
// The contract has no concept of event status, so canceled/finished rules are
// enforced client-side: the marketplace, wallet actions, and gate scanner all
// consult these helpers before doing on-chain work.

import { db } from "./firebase";
import { collection, query, where, getDocs, doc, updateDoc } from "firebase/firestore";

export const EVENT_STATUS = {
  DRAFT: "draft",
  PUBLISHED: "published",
  FINISHED: "finished",
  CANCELED: "canceled",
  DELETED: "deleted",
};

// Match on-chain eventName <-> Firestore headline. The marketplace groups
// tickets by `eventTitle.split(" #")[0]`, so strip any "#id" suffix too.
export const normalizeEventName = (s) => (s || "").split(" #")[0].trim().toLowerCase();

// Higher rank wins when several states collide for the same name.
const RANK = {
  [EVENT_STATUS.PUBLISHED]: 1,
  [EVENT_STATUS.FINISHED]: 2,
  [EVENT_STATUS.CANCELED]: 3,
};

/** Effective status: a published event whose date has passed reads as finished. */
export function effectiveStatus(ev, now = Date.now()) {
  if (!ev) return null;
  if (ev.status === EVENT_STATUS.PUBLISHED && ev.timestamp && ev.timestamp * 1000 < now) {
    return EVENT_STATUS.FINISHED;
  }
  return ev.status;
}

/** True if buying / minting / entry should be blocked for this state. */
export const isSaleBlocked = (status) =>
  status === EVENT_STATUS.CANCELED || status === EVENT_STATUS.FINISHED;

/** True if secondary transfers/resale should be frozen for this state. */
export const isTransferFrozen = (status) => status === EVENT_STATUS.CANCELED;

/**
 * Build a name -> { status, ev } map of all publicly-relevant events
 * (anything minted: published or canceled; finished is derived from published).
 * Used by the buyer marketplace + wallet to badge/freeze events.
 */
export async function fetchPublicEventStatusMap() {
  try {
    const q = query(
      collection(db, "events"),
      where("status", "in", [EVENT_STATUS.PUBLISHED, EVENT_STATUS.CANCELED])
    );
    const snap = await getDocs(q);
    const map = {};
    snap.forEach((d) => {
      const ev = { id: d.id, ...d.data() };
      const key = normalizeEventName(ev.headline);
      const eff = effectiveStatus(ev);
      const prev = map[key]?.status;
      if (!prev || (RANK[eff] || 0) > (RANK[prev] || 0)) map[key] = { status: eff, ev };
    });
    return map;
  } catch (e) {
    console.warn("[eventStatus] public map fetch failed:", e?.message);
    return {};
  }
}

/**
 * Resolve the effective status for a single on-chain event name (gate scanner).
 * Returns "published" | "finished" | "canceled" | null (null = unmanaged/legacy).
 */
export async function fetchEventStatusByName(eventName) {
  const exact = (eventName || "").trim();
  if (!exact) return null;
  try {
    const q = query(collection(db, "events"), where("headline", "==", exact));
    const snap = await getDocs(q);
    let result = null;
    snap.forEach((d) => {
      const ev = { id: d.id, ...d.data() };
      if (ev.status === EVENT_STATUS.DELETED || ev.status === EVENT_STATUS.DRAFT) return;
      const eff = effectiveStatus(ev);
      if (!result || (RANK[eff] || 0) > (RANK[result] || 0)) result = eff;
    });
    return result;
  } catch (e) {
    console.warn("[eventStatus] status-by-name fetch failed:", e?.message);
    return null;
  }
}

/** Organiser emergency-cancel: freezes the event everywhere (client-enforced). */
export const cancelEvent = (id) =>
  updateDoc(doc(db, "events", id), {
    status: EVENT_STATUS.CANCELED,
    canceledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

/** Soft-delete a draft: hidden everywhere but retained for audit. */
export const softDeleteEvent = (id) =>
  updateDoc(doc(db, "events", id), {
    status: EVENT_STATUS.DELETED,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
