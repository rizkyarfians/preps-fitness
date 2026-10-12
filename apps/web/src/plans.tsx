import { useEffect, useRef, useState } from "react";
import { ApiError, errorText } from "./api";
import { call, Failure, type Command } from "./commands";
import type {
  ManagedPlan,
  ManagedPlanPage,
  PlanDraftContent,
  PlanCommandResult,
  PlanPublicationPage,
} from "./contracts";

type Form = {
  name: string;
  amount: string;
  currency: string;
  duration: string;
  unit: "day" | "month";
  benefits: string;
};
const blank: Form = {
  name: "",
  amount: "",
  currency: "IDR",
  duration: "",
  unit: "month",
  benefits: "",
};
const formOf = (d: PlanDraftContent): Form => ({
  name: d.name || "",
  amount: d.price?.amount || "",
  currency: d.price?.currency || "IDR",
  duration: d.duration ? String(d.duration.value) : "",
  unit: d.duration?.unit || "month",
  benefits: (d.benefits || []).join("\n"),
});
const price = (d: PlanDraftContent) =>
  d.price ? `${d.price.currency} ${d.price.amount}` : "Harga belum diisi";
const duration = (d: PlanDraftContent) =>
  d.duration
    ? `${d.duration.value} ${d.duration.unit === "month" ? "bulan" : "hari"}`
    : "Durasi belum diisi";
const date = (s: string) => new Date(s).toLocaleString("id-ID");

export function Plans({
  branchId,
  onSessionError,
  onDirty,
  onBlock,
}: {
  branchId: string;
  onSessionError: (e: unknown) => void;
  onDirty: (v: boolean) => void;
  onBlock: (v: boolean) => void;
}) {
  const controller = useRef(new AbortController()),
    lock = useRef(false);
  const [list, setList] = useState<ManagedPlanPage>({ items: [] });
  const [view, setView] = useState<"list" | "detail" | "edit">("list");
  const [record, setRecord] = useState<ManagedPlan>();
  const [history, setHistory] = useState<PlanPublicationPage>({ items: [] });
  const [form, setForm] = useState<Form>({ ...blank });
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Command>(),
    [conflict, setConflict] = useState(false),
    [fields, setFields] = useState<Record<string, string>>({});
  const query = `branchId=${encodeURIComponent(branchId)}`;
  const path = (id: string, suffix = "") =>
    `/plans/${encodeURIComponent(id)}${suffix}?${query}`;
  const signal = () => controller.current.signal;
  function fail(e: unknown) {
    if (signal().aborted) return;
    if (e instanceof ApiError && [401, 403].includes(e.status)) {
      onSessionError(e);
      return;
    }
    setError(e);
    if (e instanceof Failure)
      setFields(
        Object.fromEntries(
          e.fields.map((f) => [f.field.replace(/^draft\./, ""), f.code]),
        ),
      );
  }
  async function work(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      lock.current = false;
      if (!signal().aborted) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  async function loadList(cursor?: string, requestSignal = signal()) {
    const page = await call<ManagedPlanPage>(
      `/plans?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      requestSignal,
    );
    if (requestSignal.aborted) return;
    setList((old) => ({
      ...page,
      items: cursor ? [...old.items, ...page.items] : page.items,
    }));
  }
  async function loadHistory(id: string, cursor?: string) {
    const page = await call<PlanPublicationPage>(
      `${path(id, "/versions")}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      signal(),
    );
    setHistory((old) => ({
      ...page,
      items: cursor ? [...old.items, ...page.items] : page.items,
    }));
  }
  async function detail(id: string) {
    const r = await call<ManagedPlan>(path(id), signal());
    setRecord(r);
    setForm(formOf(r.draft));
    setDirty(false);
    setConflict(false);
    setFields({});
    setHistory({ items: [] });
    setView("detail");
    await loadHistory(id);
  }
  useEffect(() => {
    const initial = new AbortController();
    controller.current = initial;
    setLoading(true);
    void loadList(undefined, initial.signal)
      .catch((e) => {
        if (!initial.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!initial.signal.aborted) setLoading(false);
      });
    return () => {
      initial.abort();
      onDirty(false);
      onBlock(false);
    };
  }, [branchId]);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBlock(busy || !!pending);
  }, [busy, pending, onBlock]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || pending || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending, busy]);
  function leave() {
    return (
      !busy &&
      !pending &&
      (!dirty || window.confirm("Tinggalkan perubahan yang belum disimpan?"))
    );
  }
  function change(key: keyof Form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setFields({});
  }
  function draft(): PlanDraftContent | undefined {
    const errors: Record<string, string> = {},
      d: PlanDraftContent = {};
    if (form.name.trim()) {
      d.name = form.name.trim();
      if (d.name.length > 200) errors.name = "Maksimal 200 karakter.";
    }
    if (form.amount.trim()) {
      const m = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,2}))?$/.exec(
        form.amount.trim(),
      );
      if (!m)
        errors["price.amount"] =
          "Gunakan angka nonnegatif, maksimal 12 digit dan 2 desimal (contoh 350000.00).";
      if (!/^[A-Z]{3}$/.test(form.currency.trim()))
        errors["price.currency"] = "Gunakan kode mata uang 3 huruf kapital.";
      if (m)
        d.price = {
          amount: `${m[1]}.${(m[2] || "").padEnd(2, "0")}`,
          currency: form.currency.trim(),
        };
    }
    if (form.duration.trim()) {
      if (
        !/^\d+$/.test(form.duration.trim()) ||
        Number(form.duration) < 1 ||
        Number(form.duration) > 2147483647
      )
        errors.duration = "Durasi harus bilangan bulat 1–2147483647.";
      else d.duration = { value: Number(form.duration), unit: form.unit };
    }
    d.benefits = form.benefits
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      d.benefits.length > 100 ||
      d.benefits.some((s) => s.length > 100) ||
      new Set(d.benefits).size !== d.benefits.length
    )
      errors.benefits =
        "Maksimal 100 benefit unik, masing-masing maksimal 100 karakter.";
    setFields(errors);
    return Object.keys(errors).length ? undefined : d;
  }
  async function execute(c: Command) {
    setPending(c);
    setConflict(false);
    let result: PlanCommandResult;
    try {
      result = await call<PlanCommandResult>(c.path, signal(), c);
    } catch (e) {
      const uncertain =
        e instanceof ApiError &&
        (e.status === 0 ||
          e.status >= 500 ||
          e.reasonCode === "COMMAND_IN_PROGRESS");
      if (!uncertain) setPending(undefined);
      if (
        e instanceof ApiError &&
        [
          "STALE_VERSION",
          "INVALID_TRANSITION",
          "IDEMPOTENCY_CONFLICT",
        ].includes(e.reasonCode)
      )
        setConflict(true);
      throw e;
    }
    setPending(undefined);
    setRecord(result.plan);
    setForm(formOf(result.plan.draft));
    setDirty(false);
    setView("detail");
    setFields({});
    setHistory({ items: [] });
    setNotice(
      result.publishedVersion
        ? `Versi ${result.publishedVersion.version} berhasil dipublikasikan. ${result.publishedVersion.price.currency} ${result.publishedVersion.price.amount}.`
        : "Draft berhasil disimpan.",
    );
    await loadHistory(result.plan.id);
  }
  function save() {
    const d = draft();
    if (!d) return;
    void work(() =>
      execute({
        path: record ? path(record.id) : "/plans",
        method: record ? "PATCH" : "POST",
        body: record
          ? { version: record.version, draft: d }
          : { branchId, draft: d },
        key: crypto.randomUUID(),
      }),
    );
  }
  function publish() {
    if (
      !record ||
      !window.confirm(
        `Publikasikan ${record.draft.name}?\n${price(record.draft)} · ${duration(record.draft)}\nVersi lama tetap tersedia untuk registrasi.`,
      )
    )
      return;
    void work(() =>
      execute({
        path: path(record.id, "/publish"),
        method: "POST",
        body: { version: record.version },
        key: crypto.randomUUID(),
      }),
    );
  }
  const frozen = busy || !!pending || conflict;
  const canPublish =
    record?.draft.name &&
    record.draft.price &&
    record.draft.duration &&
    record.draft.benefits;
  const fieldError = (key: string) => {
    const matches = Object.entries(fields).filter(
      ([k]) => k === key || k.startsWith(`${key}.`),
    );
    return matches.length ? (
      <small id={`plan-error-${key}`} className="plan-field-error" role="alert">
        {matches
          .map(
            ([, v]) =>
              (
                ({
                  REQUIRED: "Wajib diisi.",
                  TOO_LONG: "Nilai terlalu panjang.",
                  INVALID_FORMAT: "Format tidak valid.",
                }) as Record<string, string>
              )[v] || v,
          )
          .join(" · ")}
      </small>
    ) : null;
  };
  return (
    <section className="registrations plans" aria-label="Pengelolaan paket">
      <div className="section-heading">
        <h2>KELOLA PAKET</h2>
        <span>Penawaran per cabang</span>
      </div>
      <p className="plan-intro">
        Siapkan draft, periksa harga, lalu publikasikan agar paket bisa dipilih
        saat registrasi.
      </p>
      {error ? (
        <div className="reg-panel" role="alert">
          <p>
            {conflict
              ? "Paket telah berubah. Muat versi terbaru dan periksa ulang sebelum menyimpan atau publish."
              : error instanceof ApiError &&
                  error.reasonCode === "VALIDATION_FAILED"
                ? "Data belum valid. Periksa field atau lengkapi draft sebelum publish."
                : error instanceof ApiError && error.status === 404
                  ? "Paket tidak ditemukan atau tidak dapat diakses."
                  : errorText(error)}
          </p>
          {error instanceof ApiError && error.requestId && (
            <small>Referensi: {error.requestId}</small>
          )}
        </div>
      ) : null}
      {notice && (
        <p className="plan-notice" role="status">
          {notice}
        </p>
      )}
      {pending && (
        <div className="reg-panel" role="status">
          <p>
            Hasil permintaan belum pasti. Ulangi permintaan yang sama untuk
            mengonfirmasi hasilnya. Jangan reload halaman.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void work(() => execute(pending))}
          >
            Konfirmasi hasil permintaan
          </button>
        </div>
      )}
      {conflict && record && (
        <button
          className="retry"
          disabled={busy}
          onClick={() => {
            if (leave()) void work(() => detail(record.id));
          }}
        >
          Muat versi terbaru
        </button>
      )}
      {loading ? (
        <p role="status">Memuat paket…</p>
      ) : view === "list" ? (
        <>
          <div className="reg-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setRecord(undefined);
                setForm({ ...blank });
                setDirty(false);
                setFields({});
                setError(undefined);
                setNotice("");
                setConflict(false);
                setView("edit");
              }}
            >
              Buat paket
            </button>
            <button
              className="retry"
              disabled={busy}
              onClick={() => void work(() => loadList())}
            >
              Muat ulang daftar
            </button>
          </div>
          {!list.items.length && (
            <div className="reg-panel">
              <h3>BELUM ADA PAKET</h3>
              <p>Buat draft pertama untuk cabang ini.</p>
            </div>
          )}
          <div className="reg-list">
            {list.items.map((p) => (
              <button
                className="reg-row plan-row"
                key={p.id}
                disabled={busy}
                onClick={() => void work(() => detail(p.id))}
              >
                <span>
                  <strong>{p.draft.name || "Draft tanpa nama"}</strong>
                  <small>
                    {price(p.draft)} · {duration(p.draft)}
                  </small>
                </span>
                <span
                  className={`reg-status ${p.status === "published" ? "approved" : "draft"}`}
                >
                  {p.status === "published" ? "Dipublikasikan" : "Draft"}
                </span>
              </button>
            ))}
          </div>
          {list.nextCursor && (
            <button
              className="retry"
              disabled={busy}
              onClick={() => void work(() => loadList(list.nextCursor))}
            >
              Muat paket berikutnya
            </button>
          )}
        </>
      ) : (
        <>
          <button
            className="reg-back"
            disabled={busy || !!pending}
            onClick={() => {
              if (leave()) {
                setView("list");
                setRecord(undefined);
                setDirty(false);
                setConflict(false);
                setError(undefined);
                void work(() => loadList());
              }
            }}
          >
            ← Daftar paket
          </button>
          {view === "edit" ? (
            <form
              className="reg-panel"
              onSubmit={(e) => {
                e.preventDefault();
                if (!frozen) save();
              }}
            >
              <h3>{record ? "EDIT DRAFT" : "PAKET BARU"}</h3>
              <p>
                Draft boleh belum lengkap. Kosongkan harga atau durasi untuk
                menghapusnya dari draft.
              </p>
              {record?.latestVersionId && (
                <p className="plan-notice">
                  Perubahan ini tidak mengubah versi yang sudah dipublikasikan.
                </p>
              )}
              <fieldset disabled={frozen} className="plan-fieldset">
                <div className="reg-grid">
                  <label>
                    Nama paket
                    <input
                      aria-label="Nama paket"
                      aria-invalid={Object.keys(fields).some(
                        (k) => k === "name" || k.startsWith("name."),
                      )}
                      aria-describedby="plan-error-name"
                      value={form.name}
                      maxLength={200}
                      onChange={(e) => change("name", e.target.value)}
                    />
                    {fieldError("name")}
                  </label>
                  <label>
                    Harga
                    <input
                      inputMode="decimal"
                      placeholder="350000.00"
                      aria-label="Harga"
                      aria-invalid={Object.keys(fields).some(
                        (k) =>
                          k === "price.amount" || k.startsWith("price.amount."),
                      )}
                      aria-describedby="plan-error-price.amount"
                      value={form.amount}
                      onChange={(e) => change("amount", e.target.value)}
                    />
                    {fieldError("price.amount")}
                  </label>
                  <label>
                    Mata uang
                    <input
                      aria-label="Mata uang"
                      aria-invalid={Object.keys(fields).some(
                        (k) =>
                          k === "price.currency" ||
                          k.startsWith("price.currency."),
                      )}
                      aria-describedby="plan-error-price.currency"
                      value={form.currency}
                      maxLength={3}
                      onChange={(e) =>
                        change("currency", e.target.value.toUpperCase())
                      }
                    />
                    {fieldError("price.currency")}
                  </label>
                  <label>
                    Durasi
                    <input
                      inputMode="numeric"
                      aria-label="Durasi"
                      aria-invalid={Object.keys(fields).some(
                        (k) => k === "duration" || k.startsWith("duration."),
                      )}
                      aria-describedby="plan-error-duration"
                      value={form.duration}
                      onChange={(e) => change("duration", e.target.value)}
                    />
                    {fieldError("duration")}
                  </label>
                  <label>
                    Satuan durasi
                    <select
                      value={form.unit}
                      onChange={(e) => change("unit", e.target.value)}
                    >
                      <option value="month">Bulan</option>
                      <option value="day">Hari</option>
                    </select>
                  </label>
                  <label>
                    Benefit (satu per baris)
                    <textarea
                      rows={5}
                      aria-label="Benefit (satu per baris)"
                      aria-invalid={Object.keys(fields).some(
                        (k) => k === "benefits" || k.startsWith("benefits."),
                      )}
                      aria-describedby="plan-error-benefits"
                      value={form.benefits}
                      onChange={(e) => change("benefits", e.target.value)}
                    />
                    {fieldError("benefits")}
                  </label>
                </div>
                <div className="reg-actions">
                  <button className="primary" type="submit">
                    {busy ? "Menyimpan…" : "Simpan draft"}
                  </button>
                  {record && (
                    <button
                      className="retry"
                      type="button"
                      onClick={() => {
                        if (leave()) {
                          setForm(formOf(record.draft));
                          setDirty(false);
                          setFields({});
                          setView("detail");
                        }
                      }}
                    >
                      Batal edit
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
          ) : (
            record && (
              <>
                <article className="reg-panel">
                  <div className="section-heading">
                    <h3>{record.draft.name || "DRAFT TANPA NAMA"}</h3>
                    <span
                      className={`reg-status ${record.status === "published" ? "approved" : "draft"}`}
                    >
                      {record.status === "published"
                        ? "Dipublikasikan"
                        : "Draft"}
                    </span>
                  </div>
                  <p>
                    Revisi draft {record.version} · Diperbarui{" "}
                    {date(record.updatedAt)}
                  </p>
                  <dl className="reg-grid">
                    <div>
                      <dt>Harga draft</dt>
                      <dd>{price(record.draft)}</dd>
                    </div>
                    <div>
                      <dt>Durasi</dt>
                      <dd>{duration(record.draft)}</dd>
                    </div>
                  </dl>
                  <h4>Benefit</h4>
                  {record.draft.benefits?.length ? (
                    <ul>
                      {record.draft.benefits.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>Tanpa benefit tambahan.</p>
                  )}
                  <div className="reg-actions">
                    {record.allowedActions.includes("edit") && (
                      <button
                        className="retry"
                        disabled={frozen}
                        onClick={() => {
                          setForm(formOf(record.draft));
                          setFields({});
                          setView("edit");
                        }}
                      >
                        Edit draft
                      </button>
                    )}
                    {record.allowedActions.includes("publish") && (
                      <button
                        className="primary"
                        disabled={frozen || !canPublish}
                        onClick={publish}
                      >
                        Publikasikan paket
                      </button>
                    )}
                    <button
                      className="retry"
                      disabled={busy || !!pending}
                      onClick={() => void work(() => detail(record.id))}
                    >
                      Muat ulang detail
                    </button>
                  </div>
                  {record.status === "draft" && !canPublish && (
                    <p>
                      Lengkapi nama, harga, durasi, dan daftar benefit melalui
                      edit draft sebelum publish. Benefit boleh kosong.
                    </p>
                  )}
                  <p className="plan-intro">
                    Publish membuat versi baru. Versi lama tetap tersedia; harga
                    registrasi dan order sebelumnya tetap.
                  </p>
                </article>
                <section className="reg-panel" aria-label="Riwayat versi">
                  <div className="section-heading">
                    <h3>RIWAYAT VERSI</h3>
                    <button
                      className="retry"
                      disabled={busy || !!pending}
                      onClick={() => void work(() => loadHistory(record.id))}
                    >
                      Muat ulang riwayat
                    </button>
                  </div>
                  {!history.items.length && (
                    <p>
                      Belum ada versi yang dimuat. Paket baru tampil di
                      registrasi setelah dipublikasikan.
                    </p>
                  )}
                  {history.items.map(({ offer, selectable }) => (
                    <article className="plan-history" key={offer.id}>
                      <div className="section-heading">
                        <h4>
                          Versi {offer.version} — {offer.name}
                        </h4>
                        <span
                          className={`reg-status ${selectable ? "approved" : "draft"}`}
                        >
                          {selectable
                            ? "Tersedia untuk registrasi"
                            : "Tidak tersedia"}
                        </span>
                      </div>
                      <p>
                        {price(offer)} · {duration(offer)}
                      </p>
                      <p>Dipublikasikan {date(offer.publishedAt)}</p>
                      {offer.benefits.length ? (
                        <ul>
                          {offer.benefits.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>Tanpa benefit tambahan.</p>
                      )}
                      <small>ID versi: {offer.id}</small>
                    </article>
                  ))}
                  {history.nextCursor && (
                    <button
                      className="retry"
                      disabled={busy || !!pending}
                      onClick={() =>
                        void work(() =>
                          loadHistory(record.id, history.nextCursor),
                        )
                      }
                    >
                      Muat riwayat berikutnya
                    </button>
                  )}
                </section>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
