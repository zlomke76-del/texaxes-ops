"use client";

import { useEffect, useMemo, useState } from "react";

type PaymentStatus = "paid" | "pending" | "failed" | "void" | "unknown";
type BookingStatus =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "paid"
  | "checked_in"
  | "completed"
  | "expired"
  | "no_show"
  | "unknown";

type WaiverStatus = "signed" | "missing" | "guardian_required" | "unknown";

type BookingRow = {
  booking_id: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  party_size: number;
  booking_type: string | null;
  booking_source: string | null;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  waiver_status: WaiverStatus;
  total_amount: number;
  amount_paid: number;
  customer_notes: string | null;
  internal_notes: string | null;
  allocation_mode: string | null;
  bays_allocated: number | null;
  created_at: string | null;
};

type Summary = {
  booking_count: number;
  paid_count: number;
  unpaid_count: number;
  checked_in_count: number;
  completed_count: number;
  expected_revenue: number;
  collected_revenue: number;
};

type TodayResponse = {
  date: string;
  summary: Summary;
  bookings: BookingRow[];
};

type FilterKey =
  | "all"
  | "upcoming"
  | "unpaid"
  | "checked_in"
  | "completed"
  | "no_show";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatMoney(value: number) {
  return money.format(Number(value || 0));
}

function formatTime(value: string) {
  const [hour, minute] = String(value || "00:00:00").split(":").map(Number);
  const date = new Date();
  date.setHours(hour || 0, minute || 0, 0, 0);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusTone(status: string) {
  switch (status) {
    case "paid":
    case "checked_in":
    case "completed":
    case "signed":
      return "good";
    case "pending":
    case "awaiting_payment":
    case "missing":
    case "guardian_required":
      return "warn";
    case "failed":
    case "expired":
    case "no_show":
    case "void":
      return "bad";
    default:
      return "neutral";
  }
}

export default function StaffTodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  async function loadBoard() {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/admin/bookings-today", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load bookings");
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBoard();
  }, []);

  const filteredBookings = useMemo(() => {
    const rows = data?.bookings || [];
    if (filter === "all") return rows;
    if (filter === "unpaid") {
      return rows.filter(
        (row) => row.payment_status !== "paid" && row.booking_status !== "completed"
      );
    }
    if (filter === "checked_in") {
      return rows.filter((row) => row.booking_status === "checked_in");
    }
    if (filter === "completed") {
      return rows.filter((row) => row.booking_status === "completed");
    }
    if (filter === "no_show") {
      return rows.filter((row) => row.booking_status === "no_show");
    }
    if (filter === "upcoming") {
      return rows.filter((row) =>
        ["pending", "awaiting_payment", "confirmed", "paid"].includes(
          row.booking_status
        )
      );
    }
    return rows;
  }, [data, filter]);

  async function applyUpdate(
    bookingId: string,
    updates: Record<string, unknown>,
    successMessage?: string
  ) {
    try {
      setBusyId(bookingId);
      const res = await fetch("/api/admin/update-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, ...updates }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Update failed");
      await loadBoard();
      if (successMessage) console.log(successMessage);
    } catch (err: any) {
      alert(err?.message || "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleEditNotes(row: BookingRow) {
    const next = window.prompt(
      "Update internal notes",
      row.internal_notes || row.customer_notes || ""
    );
    if (next === null) return;
    await applyUpdate(row.booking_id, { internal_notes: next });
  }

  async function handleEditPartySize(row: BookingRow) {
    const next = window.prompt("Update party size", String(row.party_size || 1));
    if (next === null) return;
    const size = Number(next);
    if (!Number.isInteger(size) || size <= 0) {
      alert("Invalid party size");
      return;
    }
    await applyUpdate(row.booking_id, { party_size: size });
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-orange-300/80">
              Tex Axes Staff
            </div>
            <h1 className="text-4xl font-black tracking-tight">Today’s Operations</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/70">
              Live front-desk board for today’s bookings, payment visibility, and
              quick operational adjustments.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={loadBoard}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold hover:bg-white/10"
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/70">
            Loading today’s board...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-400/20 bg-red-500/10 p-6 text-red-200">
            {error}
          </div>
        ) : (
          <>
            <section className="mb-6 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Bookings" value={String(data?.summary.booking_count || 0)} />
              <StatCard label="Paid" value={String(data?.summary.paid_count || 0)} />
              <StatCard label="Unpaid" value={String(data?.summary.unpaid_count || 0)} />
              <StatCard
                label="Checked In"
                value={String(data?.summary.checked_in_count || 0)}
              />
              <StatCard
                label="Expected"
                value={formatMoney(data?.summary.expected_revenue || 0)}
              />
              <StatCard
                label="Collected"
                value={formatMoney(data?.summary.collected_revenue || 0)}
              />
            </section>

            <section className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    ["all", "All"],
                    ["upcoming", "Upcoming"],
                    ["unpaid", "Unpaid"],
                    ["checked_in", "Checked In"],
                    ["completed", "Completed"],
                    ["no_show", "No Show"],
                  ] as Array<[FilterKey, string]>
                ).map(([key, label]) => {
                  const active = filter === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                        active
                          ? "bg-orange-500 text-white"
                          : "border border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
              <div className="hidden grid-cols-[110px_1.4fr_1fr_1fr_1fr_180px] gap-4 border-b border-white/10 px-5 py-4 text-xs font-bold uppercase tracking-[0.16em] text-white/45 lg:grid">
                <div>Time</div>
                <div>Guest / Group</div>
                <div>Details</div>
                <div>Payment</div>
                <div>Status</div>
                <div>Actions</div>
              </div>

              {filteredBookings.length === 0 ? (
                <div className="p-8 text-white/65">No bookings match this view.</div>
              ) : (
                filteredBookings.map((row) => {
                  const isExpanded = expanded === row.booking_id;
                  const busy = busyId === row.booking_id;

                  return (
                    <div
                      key={row.booking_id}
                      className="border-b border-white/10 last:border-b-0"
                    >
                      <div className="grid gap-4 px-5 py-5 lg:grid-cols-[110px_1.4fr_1fr_1fr_1fr_180px] lg:items-start">
                        <div>
                          <div className="text-base font-black">
                            {formatTime(row.start_time)}
                          </div>
                          <div className="text-sm text-white/55">
                            {formatTime(row.end_time)}
                          </div>
                        </div>

                        <div>
                          <div className="text-base font-bold">{row.customer_name}</div>
                          <div className="mt-1 text-sm text-white/65">
                            {row.email || "No email"}
                          </div>
                          <div className="text-sm text-white/55">
                            {row.phone || "No phone"}
                          </div>
                        </div>

                        <div>
                          <div className="text-sm font-semibold text-white">
                            Party of {row.party_size}
                          </div>
                          <div className="mt-1 text-sm text-white/65">
                            {row.booking_type || "open"} · {row.booking_source || "unknown"}
                          </div>
                          <div className="mt-1 text-sm text-white/55">
                            Bays: {row.bays_allocated ?? "-"} · {row.allocation_mode || "-"}
                          </div>
                        </div>

                        <div>
                          <StatusPill label={row.payment_status} tone={getStatusTone(row.payment_status)} />
                          <div className="mt-2 text-sm text-white/75">
                            Due: {formatMoney(row.total_amount)}
                          </div>
                          <div className="text-sm text-white/55">
                            Paid: {formatMoney(row.amount_paid)}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <StatusPill label={row.booking_status} tone={getStatusTone(row.booking_status)} />
                          <StatusPill label={row.waiver_status} tone={getStatusTone(row.waiver_status)} />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={busy}
                            onClick={() =>
                              applyUpdate(row.booking_id, {
                                payment_status: "paid",
                                booking_status:
                                  row.booking_status === "awaiting_payment"
                                    ? "paid"
                                    : row.booking_status,
                                amount_paid: row.total_amount,
                              })
                            }
                            className="rounded-xl bg-green-500 px-3 py-2 text-xs font-bold text-white hover:bg-green-400 disabled:opacity-50"
                          >
                            Mark Paid
                          </button>

                          <button
                            disabled={busy}
                            onClick={() =>
                              applyUpdate(row.booking_id, { booking_status: "checked_in" })
                            }
                            className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-bold text-white hover:bg-blue-400 disabled:opacity-50"
                          >
                            Check In
                          </button>

                          <button
                            disabled={busy}
                            onClick={() =>
                              applyUpdate(row.booking_id, { booking_status: "completed" })
                            }
                            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15 disabled:opacity-50"
                          >
                            Complete
                          </button>

                          <button
                            disabled={busy}
                            onClick={() =>
                              applyUpdate(row.booking_id, { booking_status: "no_show" })
                            }
                            className="rounded-xl bg-red-500/80 px-3 py-2 text-xs font-bold text-white hover:bg-red-400 disabled:opacity-50"
                          >
                            No Show
                          </button>

                          <button
                            disabled={busy}
                            onClick={() =>
                              setExpanded(isExpanded ? null : row.booking_id)
                            }
                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-50"
                          >
                            {isExpanded ? "Hide" : "Details"}
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="border-t border-white/10 bg-black/15 px-5 py-4">
                          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <DetailBox
                              title="Customer Notes"
                              value={row.customer_notes || "None"}
                            />
                            <DetailBox
                              title="Internal Notes"
                              value={row.internal_notes || "None"}
                            />
                            <DetailBox
                              title="Payment Snapshot"
                              value={`Status: ${row.payment_status}\nDue: ${formatMoney(
                                row.total_amount
                              )}\nPaid: ${formatMoney(row.amount_paid)}`}
                            />
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
                                Quick Adjust
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => handleEditPartySize(row)}
                                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15"
                                >
                                  Edit Party Size
                                </button>
                                <button
                                  onClick={() => handleEditNotes(row)}
                                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15"
                                >
                                  Edit Notes
                                </button>
                                <button
                                  onClick={() =>
                                    applyUpdate(row.booking_id, {
                                      payment_status: "pending",
                                      amount_paid: 0,
                                    })
                                  }
                                  className="rounded-xl bg-yellow-500/80 px-3 py-2 text-xs font-bold text-white hover:bg-yellow-400"
                                >
                                  Mark Unpaid
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">
        {label}
      </div>
      <div className="mt-2 text-3xl font-black tracking-tight">{value}</div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: string }) {
  const toneClass =
    tone === "good"
      ? "bg-green-500/15 text-green-200 border-green-400/20"
      : tone === "warn"
      ? "bg-yellow-500/15 text-yellow-200 border-yellow-400/20"
      : tone === "bad"
      ? "bg-red-500/15 text-red-200 border-red-400/20"
      : "bg-white/10 text-white/75 border-white/10";

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${toneClass}`}
    >
      {label.replaceAll("_", " ")}
    </span>
  );
}

function DetailBox({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
        {title}
      </div>
      <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-white/75">
        {value}
      </pre>
    </div>
  );
}
