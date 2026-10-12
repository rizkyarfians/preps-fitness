import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { call, Failure, type Command } from "./commands";
import type {
  CandidateResult,
  Registration,
  RegistrationContext,
  RegistrationIdentity,
  RegistrationPage,
  PlanVersion,
  PlanVersionPage,
  RegistrationCommandResult,
  MemberProfile,
} from "./contracts";
const labels = {
  draft: "Draft",
  pending_review: "Menunggu review",
  needs_clarification: "Perlu perbaikan",
  approved: "Disetujui",
  rejected: "Ditolak",
};
const messages: Record<string, string> = {
  STALE_VERSION: "Pengajuan diubah admin lain. Muat versi terbaru.",
  INVALID_TRANSITION: "Status sudah berubah. Muat versi terbaru.",
  DUPLICATE_REVIEW_REQUIRED: "Periksa kecocokan identitas sebelum melanjutkan.",
  DUPLICATE_CHECK_STALE:
    "Pemeriksaan duplikat kedaluwarsa atau berubah. Periksa kembali.",
  EXISTING_REGISTRATION:
    "Member memiliki pengajuan yang masih menunggu review atau perbaikan di cabang ini.",
  PLAN_UNAVAILABLE: "Paket tidak tersedia. Muat ulang pilihan paket.",
  IDEMPOTENCY_CONFLICT:
    "Permintaan berbeda memakai kunci yang sama. Muat versi terbaru.",
  VALIDATION_FAILED: "Periksa data yang ditandai.",
  PROFILE_INCOMPLETE: "Lengkapi data pengajuan sebelum mengirim.",
  NOT_FOUND: "Pengajuan tidak ditemukan atau tidak dapat diakses.",
  NETWORK_ERROR: "Koneksi terputus.",
  SERVICE_UNAVAILABLE: "Layanan belum tersedia.",
  COMMAND_IN_PROGRESS: "Permintaan masih diproses.",
  INVALID_RESPONSE: "Respons belum dapat dipastikan.",
};
const blank: RegistrationIdentity = {
  fullName: "",
  phone: "",
  address: "",
  birthDate: "",
};
const names: Record<string, string> = {
  fullName: "Nama lengkap",
  phone: "Nomor WhatsApp",
  address: "Alamat domisili",
  birthDate: "Tanggal lahir",
  birthPlace: "Tempat lahir",
  email: "Email",
};
const money = (p: PlanVersion) => `${p.price.currency} ${p.price.amount}`;
export function Registrations({
  branchId,
  onSessionError,
  onDirty,
  onBlock,
}: {
  branchId: string;
  onSessionError: (e: unknown) => void;
  onDirty: (dirty: boolean) => void;
  onBlock: (blocked: boolean) => void;
}) {
  const controller = useRef(new AbortController()),
    locked = useRef(false);
  const [context, setContext] = useState<RegistrationContext>(),
    [plans, setPlans] = useState<PlanVersion[]>([]),
    [list, setList] = useState<RegistrationPage>({ items: [] });
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [view, setView] = useState<"list" | "form" | "detail">("list");
  const [record, setRecord] = useState<Registration>(),
    [identity, setIdentity] = useState<RegistrationIdentity>({ ...blank }),
    [plan, setPlan] = useState(""),
    [country, setCountry] = useState("ID"),
    [existing, setExisting] = useState("");
  const [candidate, setCandidate] = useState<CandidateResult>(),
    [distinct, setDistinct] = useState(""),
    [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<Command>(),
    [conflict, setConflict] = useState(false),
    [fields, setFields] = useState<Record<string, string>>({});
  const signal = () => controller.current.signal;
  function fail(e: unknown) {
    if (signal().aborted) return;
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onSessionError(e);
      return;
    }
    setError(e);
    if (e instanceof Failure && e.fields.length)
      setFields(
        Object.fromEntries(
          e.fields.map((f) => [f.field.replace(/^identity\./, ""), f.code]),
        ),
      );
  }
  async function work(fn: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      locked.current = false;
      if (!signal().aborted) setBusy(false);
    }
  }
  async function clock() {
    const c = await call<RegistrationContext>(
      `/registration-context?branchId=${encodeURIComponent(branchId)}`,
      signal(),
    );
    setContext(c);
    return c;
  }
  async function offers() {
    let cursor: string | undefined;
    const items: PlanVersion[] = [];
    do {
      const p = await call<PlanVersionPage>(
        `/plan-versions?branchId=${encodeURIComponent(branchId)}&limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
        signal(),
      );
      items.push(...p.items);
      cursor = p.nextCursor;
    } while (cursor);
    setPlans(items);
  }
  async function rows(cursor?: string) {
    const q = new URLSearchParams({
      branchId,
      limit: "25",
      ...(search ? { search } : {}),
      ...(filter ? { status: filter } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const result = await call<RegistrationPage>(
      `/registrations?${q}`,
      signal(),
    );
    setList((old) =>
      cursor ? { ...result, items: [...old.items, ...result.items] } : result,
    );
  }
  useEffect(() => {
    const ac = new AbortController();
    controller.current = ac;
    void Promise.all([clock(), offers(), rows()])
      .catch((e) => {
        if (!ac.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [branchId]);
  useEffect(() => {
    onBlock(busy || !!pending);
    return () => onBlock(false);
  }, [busy, pending, onBlock]);
  useEffect(() => {
    onDirty(dirty || !!pending || busy);
    return () => onDirty(false);
  }, [dirty, pending, busy, onDirty]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || pending || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, pending, busy]);
  function accept(r: Registration) {
    setRecord(r);
    setIdentity({ ...blank, ...r.identity });
    setPlan(r.offer.id);
    setDirty(false);
    setCandidate(undefined);
    setDistinct("");
    setReason("");
    setConflict(false);
    setFields({});
    setView("detail");
  }
  async function open(id: string) {
    accept(
      await call<Registration>(
        `/registrations/${encodeURIComponent(id)}`,
        signal(),
      ),
    );
  }
  function change(field: string, value: string) {
    setIdentity((old) => ({ ...old, [field]: value }));
    setCandidate(undefined);
    setDistinct("");
    setDirty(true);
    setFields((old) => ({ ...old, [field]: "" }));
  }
  async function validated(): Promise<RegistrationIdentity> {
    const c = await clock();
    const value = Object.fromEntries(
      Object.entries(identity)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v !== ""),
    ) as RegistrationIdentity;
    let phone = value.phone?.replace(/[\s()-]/g, "") || "";
    if (country === "ID" && phone.startsWith("08"))
      phone = "+62" + phone.slice(1);
    value.phone = phone;
    const errors: Record<string, string> = {};
    for (const key of ["fullName", "phone", "address", "birthDate"])
      if (!value[key as keyof RegistrationIdentity])
        errors[key] = "Wajib diisi";
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      errors.phone = "Gunakan nomor internasional, misalnya +6281234567890";
    const date = value.birthDate || "",
      parsed = new Date(date + "T00:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date ||
      date < "1000-01-01" ||
      date > c.today
    )
      errors.birthDate = "Tanggal tidak valid atau melebihi hari ini";
    setFields(errors);
    if (Object.keys(errors).length)
      throw new Failure(422, { reasonCode: "VALIDATION_FAILED" });
    setIdentity({ ...blank, ...value });
    return value;
  }
  async function check(value: RegistrationIdentity) {
    const c = await call<CandidateResult>(
      "/member-candidates",
      signal(),
      undefined,
      { branchId, identity: value },
    );
    setCandidate(c);
    return c;
  }
  function resolutionReviewed(c: CandidateResult, exclude?: string) {
    const ids = (value?: CandidateResult) =>
      value?.candidates
        .filter((x) => x.memberId !== exclude)
        .map((x) => x.memberId)
        .sort()
        .join(",");
    if (distinct.trim() && ids(candidate) !== ids(c)) {
      setDistinct("");
      setNotice(
        "Daftar kecocokan berubah. Tinjau kembali sebelum menyatakan orang berbeda.",
      );
      return false;
    }
    return true;
  }
  async function execute(c: Command) {
    setPending(c);
    try {
      const result = await call<RegistrationCommandResult>(c.path, signal(), c);
      if (signal().aborted) return;
      setPending(undefined);
      accept(result.registration);
      setNotice("Tersimpan. Status: " + labels[result.registration.status]);
    } catch (e) {
      if (signal().aborted) return;
      const unknown =
        e instanceof ApiError &&
        (e.status === 0 ||
          e.status >= 500 ||
          e.reasonCode === "COMMAND_IN_PROGRESS");
      if (!unknown) setPending(undefined);
      if (
        e instanceof ApiError &&
        [
          "STALE_VERSION",
          "INVALID_TRANSITION",
          "IDEMPOTENCY_CONFLICT",
        ].includes(e.reasonCode)
      )
        setConflict(true);
      if (
        e instanceof ApiError &&
        ["DUPLICATE_REVIEW_REQUIRED", "DUPLICATE_CHECK_STALE"].includes(
          e.reasonCode,
        )
      )
        setCandidate(undefined);
      throw e;
    }
  }
  const command = (path: string, body: object, method = "POST") =>
    execute({ path, body, method, key: crypto.randomUUID() });
  async function save() {
    const value = existing && !record ? undefined : await validated();
    if (!plan) throw new Failure(422, { reasonCode: "PLAN_UNAVAILABLE" });
    if (record) {
      await command(
        `/registrations/${record.id}`,
        { version: record.version, planVersionId: plan, identity: value },
        "PATCH",
      );
      return;
    }
    if (existing) {
      await command("/registrations", {
        branchId,
        planVersionId: plan,
        memberId: existing,
      });
      return;
    }
    const c = await check(value!);
    if (c.restrictedMatch) {
      setNotice(
        "Identitas cocok di cabang terbatas. Hubungi reviewer berwenang.",
      );
      return;
    }
    if (!resolutionReviewed(c)) return;
    if (c.candidates.length && !distinct.trim()) {
      setNotice("Pilih member yang sudah ada atau isi alasan orang berbeda.");
      return;
    }
    await command("/registrations", {
      branchId,
      planVersionId: plan,
      identity: value,
      ...(c.candidates.length
        ? {
            duplicateResolution: {
              decision: "distinct_person",
              reason: distinct.trim(),
              candidateCheckId: c.candidateCheckId,
            },
          }
        : {}),
    });
  }
  async function submit() {
    if (!record) return;
    const value = await validated(),
      c = await check(value),
      others = c.candidates.filter((x) => x.memberId !== record.memberId);
    if (c.restrictedMatch) {
      setNotice("Ada kecocokan terbatas. Hubungi reviewer berwenang.");
      return;
    }
    if (!resolutionReviewed(c, record.memberId)) return;
    if (others.length && !distinct.trim()) {
      setNotice(
        "Periksa kecocokan identitas dan isi alasan orang berbeda sebelum mengirim.",
      );
      return;
    }
    await command(`/registrations/${record.id}/submit`, {
      version: record.version,
      ...(others.length
        ? {
            duplicateResolution: {
              decision: "distinct_person",
              reason: distinct.trim(),
              candidateCheckId: c.candidateCheckId,
            },
          }
        : {}),
    });
  }
  async function review(decision: "approve" | "reject" | "clarify") {
    if (!record) return;
    if (decision !== "approve" && !reason.trim()) {
      setFields({ reason: "Alasan wajib diisi" });
      return;
    }
    if (
      !window.confirm(
        `${decision === "approve" ? "Setujui" : decision === "reject" ? "Tolak" : "Minta perbaikan untuk"} pengajuan ${record.identity.fullName}?`,
      )
    )
      return;
    await command(`/registrations/${record.id}/review`, {
      decision,
      version: record.version,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  }
  useEffect(() => {
    if (Object.values(fields).some(Boolean))
      document
        .querySelector<HTMLElement>('.registrations [aria-invalid="true"]')
        ?.focus();
  }, [fields]);
  const duplicates =
    candidate?.candidates.filter((c) => c.memberId !== record?.memberId) || [];
  return (
    <section className="registrations" aria-busy={busy || loading}>
      <div className="section-heading">
        <h2>REGISTRASI MEMBER</h2>
        <span>{context?.timezone}</span>
      </div>
      {!!error && (
        <div className="error" role="alert">
          {error instanceof ApiError
            ? messages[error.reasonCode] || "Permintaan tidak dapat diproses."
            : "Terjadi kendala."}
          {error instanceof ApiError && (
            <small>Referensi: {error.requestId || error.reasonCode}</small>
          )}
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!!Object.values(fields).filter(Boolean).length && (
        <ul className="error" role="alert">
          {Object.entries(fields)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <li key={k}>
                {names[k] || k}: {v}
              </li>
            ))}
        </ul>
      )}
      {pending && !busy && (
        <div className="reg-panel">
          <p>
            Hasil permintaan belum pasti. Data dikunci agar tidak terkirim dua
            kali.
          </p>
          <button
            className="primary"
            onClick={() => void work(() => execute(pending))}
          >
            Konfirmasi permintaan yang sama
          </button>
        </div>
      )}
      {conflict && record && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void work(() => open(record.id))}
        >
          Muat versi terbaru
        </button>
      )}
      {loading ? (
        <p role="status">Memuat registrasi…</p>
      ) : (
        <fieldset disabled={busy || !!pending || conflict}>
          {view === "list" ? (
            <>
              <div className="reg-toolbar">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(() => rows());
                  }}
                >
                  <label>
                    Cari nama
                    <input
                      maxLength={200}
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setList((old) => ({ ...old, nextCursor: undefined }));
                      }}
                    />
                  </label>
                  <label>
                    Status
                    <select
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setList((old) => ({ ...old, nextCursor: undefined }));
                      }}
                    >
                      <option value="">Semua status</option>
                      {Object.entries(labels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="secondary">Cari / muat ulang</button>
                </form>
                {context?.allowedActions.includes("create") && (
                  <button
                    className="primary"
                    onClick={() => {
                      setRecord(undefined);
                      setIdentity({ ...blank });
                      setPlan("");
                      setExisting("");
                      setCandidate(undefined);
                      setDistinct("");
                      setView("form");
                      setNotice("");
                    }}
                  >
                    Registrasi baru
                  </button>
                )}
              </div>
              {!list.items.length ? (
                <p className="reg-panel">Belum ada registrasi yang cocok.</p>
              ) : (
                <div className="reg-list">
                  {list.items.map((r) => (
                    <button
                      className="reg-row"
                      key={r.id}
                      onClick={() => void work(() => open(r.id))}
                    >
                      <span>
                        <strong>{r.fullName}</strong>
                        <small>{r.planName}</small>
                      </span>
                      <span className={`reg-status ${r.status}`}>
                        {labels[r.status]}
                      </span>
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              )}
              {list.nextCursor && (
                <button
                  className="secondary"
                  onClick={() => void work(() => rows(list.nextCursor))}
                >
                  Muat berikutnya
                </button>
              )}
              {!context && (
                <button
                  className="secondary"
                  onClick={() =>
                    void work(async () => {
                      await clock();
                      await offers();
                      await rows();
                    })
                  }
                >
                  Coba muat kembali
                </button>
              )}
            </>
          ) : (
            <>
              <button
                className="text-button"
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm("Tinggalkan perubahan yang belum disimpan?")
                  )
                    void work(async () => {
                      await rows();
                      setView("list");
                      setDirty(false);
                      setCandidate(undefined);
                    });
                }}
              >
                ← Daftar registrasi
              </button>
              {record && (
                <div className="reg-panel">
                  <span className={`reg-status ${record.status}`}>
                    {labels[record.status]}
                  </span>
                  <p>
                    ID pengajuan: <code>{record.id}</code> · Versi{" "}
                    {record.version}
                  </p>
                  {record.orderId && (
                    <p>
                      Order: <code>{record.orderId}</code>. Membership belum
                      aktif.
                    </p>
                  )}
                </div>
              )}
              {view === "form" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(save);
                  }}
                  className="reg-panel"
                >
                  <h3>{record ? "PERBAIKI PENGAJUAN" : "DATA CALON MEMBER"}</h3>
                  {existing && !record && (
                    <p className="notice">
                      Menggunakan profil member yang sudah ada. Koreksi snapshot
                      dapat dilakukan setelah draft disimpan.
                    </p>
                  )}
                  <div className="reg-grid">
                    <label>
                      Format nomor
                      <select
                        disabled={!!existing && !record}
                        value={country}
                        onChange={(e) => {
                          setCountry(e.target.value);
                          setCandidate(undefined);
                          setDirty(true);
                        }}
                      >
                        <option value="ID">Indonesia (+62)</option>
                        <option value="international">
                          Internasional (+kode negara)
                        </option>
                      </select>
                    </label>
                    {Object.entries(names).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        {key === "email" || key === "birthPlace"
                          ? " (opsional)"
                          : " *"}
                        {key === "address" ? (
                          <textarea
                            disabled={!!existing && !record}
                            required
                            maxLength={1000}
                            value={identity.address}
                            aria-invalid={!!fields[key]}
                            onChange={(e) => change(key, e.target.value)}
                          />
                        ) : (
                          <input
                            disabled={!!existing && !record}
                            required={key !== "email" && key !== "birthPlace"}
                            type={
                              key === "birthDate"
                                ? "date"
                                : key === "email"
                                  ? "email"
                                  : key === "phone"
                                    ? "tel"
                                    : "text"
                            }
                            min={key === "birthDate" ? "1000-01-01" : undefined}
                            maxLength={
                              key === "fullName"
                                ? 200
                                : key === "birthPlace"
                                  ? 120
                                  : key === "email"
                                    ? 254
                                    : key === "phone"
                                      ? 30
                                      : undefined
                            }
                            value={
                              identity[key as keyof RegistrationIdentity] || ""
                            }
                            aria-invalid={!!fields[key]}
                            onChange={(e) => change(key, e.target.value)}
                          />
                        )}
                      </label>
                    ))}
                    <label>
                      Paket *
                      <select
                        required
                        value={plan}
                        onChange={(e) => {
                          setPlan(e.target.value);
                          setDirty(true);
                        }}
                      >
                        <option value="">Pilih paket</option>
                        {record &&
                          !plans.some((p) => p.id === record.offer.id) && (
                            <option value={record.offer.id} disabled>
                              {record.offer.name} — tidak tersedia
                            </option>
                          )}
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {money(p)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {!plans.length && (
                    <p>Belum ada paket yang dapat dipilih di cabang ini.</p>
                  )}
                  {plans.find((p) => p.id === plan) && (
                    <p>
                      {plans.find((p) => p.id === plan)!.benefits.join(" · ")}
                    </p>
                  )}
                  <div className="reg-actions">
                    {!existing && !record && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void work(async () => {
                            await check(await validated());
                          })
                        }
                      >
                        Periksa duplikat
                      </button>
                    )}
                    <button className="primary">
                      {record ? "Simpan perbaikan" : "Simpan draft"}
                    </button>
                  </div>
                </form>
              ) : (
                record && (
                  <div className="reg-panel">
                    <h3>{record.identity.fullName}</h3>
                    <dl className="reg-grid">
                      {Object.entries(names).map(([k, v]) => (
                        <div key={k}>
                          <dt>{v}</dt>
                          <dd>
                            {record.identity[k as keyof RegistrationIdentity] ||
                              "—"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p>
                      {record.offer.name} · {money(record.offer)}
                    </p>
                    <p>
                      Durasi paket: {record.offer.duration.value}{" "}
                      {record.offer.duration.unit === "month"
                        ? "bulan"
                        : "hari"}
                    </p>
                    <p className="muted">
                      Persetujuan membuat order. Aktivasi membership dilakukan
                      pada tahap berikutnya.
                    </p>
                    <div className="reg-actions">
                      {record.allowedActions.includes("edit") && (
                        <button
                          className="secondary"
                          onClick={() => {
                            setView("form");
                            setCandidate(undefined);
                            setDistinct("");
                          }}
                        >
                          Perbaiki data
                        </button>
                      )}
                      {record.allowedActions.includes("submit") && (
                        <button
                          className="primary"
                          onClick={() => void work(submit)}
                        >
                          Kirim untuk review
                        </button>
                      )}
                    </div>
                    {record.allowedActions.some((a) =>
                      ["approve", "reject", "clarify"].includes(a),
                    ) && (
                      <div className="reg-review">
                        <label>
                          Alasan review
                          <textarea
                            maxLength={1000}
                            value={reason}
                            onChange={(e) => {
                              setReason(e.target.value);
                              setDirty(true);
                            }}
                          />
                        </label>
                        <div className="reg-actions">
                          {(["approve", "clarify", "reject"] as const)
                            .filter((a) => record.allowedActions.includes(a))
                            .map((a) => (
                              <button
                                className={
                                  a === "approve" ? "primary" : "secondary"
                                }
                                key={a}
                                onClick={() => void work(() => review(a))}
                              >
                                {a === "approve"
                                  ? "Setujui"
                                  : a === "reject"
                                    ? "Tolak"
                                    : "Minta perbaikan"}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                    <h3>RIWAYAT REVIEW</h3>
                    {!record.history.length ? (
                      <p>Belum ada review.</p>
                    ) : (
                      record.history.map((h, i) => (
                        <article className="reg-history" key={i}>
                          <strong>
                            {h.decision === "approve"
                              ? "Disetujui"
                              : h.decision === "reject"
                                ? "Ditolak"
                                : "Perlu perbaikan"}
                          </strong>
                          <p>{h.reason || "Tanpa catatan"}</p>
                          <small>
                            {h.at} · Reviewer {h.actorId}
                          </small>
                        </article>
                      ))
                    )}
                  </div>
                )
              )}
              {candidate && (
                <div className="reg-panel">
                  <h3>PEMERIKSAAN IDENTITAS</h3>
                  {candidate.restrictedMatch ? (
                    <p role="alert">
                      Ada kecocokan di cabang yang tidak dapat diakses. Hubungi
                      reviewer berwenang.
                    </p>
                  ) : duplicates.length ? (
                    <>
                      <p>Kontak yang sama belum tentu orang yang sama.</p>
                      {duplicates.map((c) => (
                        <div className="reg-history" key={c.memberId}>
                          <strong>{c.displayName}</strong>
                          <p>Kecocokan: {c.matchReasons.join(", ")}</p>
                          {!record && (
                            <button
                              className="secondary"
                              onClick={() =>
                                void work(async () => {
                                  const m = await call<MemberProfile>(
                                    `/members/${encodeURIComponent(c.memberId)}?branchId=${encodeURIComponent(branchId)}`,
                                    signal(),
                                  );
                                  setExisting(m.id);
                                  setIdentity({ ...blank, ...m.identity });
                                  setCandidate(undefined);
                                  setDirty(true);
                                })
                              }
                            >
                              Gunakan member ini
                            </button>
                          )}
                        </div>
                      ))}
                      <label>
                        Alasan orang berbeda
                        <textarea
                          maxLength={1000}
                          value={distinct}
                          onChange={(e) => {
                            setDistinct(e.target.value);
                            setDirty(true);
                          }}
                        />
                      </label>
                      <p className="muted">
                        Simpan draft atau kirim kembali setelah alasan diisi.
                        Kecocokan akan diperiksa ulang.
                      </p>
                    </>
                  ) : (
                    <p>Tidak ada kecocokan dengan member lain.</p>
                  )}
                </div>
              )}
              <button className="text-button" onClick={() => void work(offers)}>
                Muat ulang paket
              </button>
            </>
          )}
        </fieldset>
      )}
      {busy && <p role="status">Memproses…</p>}
    </section>
  );
}
