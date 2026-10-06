import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChevronDown,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  Wallet,
  CalendarDays,
  ChartNoAxesCombined,
  LockKeyhole,
  X,
  RefreshCw,
} from "./icons";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./styles.css";
import { ApiError, auth, errorText, getBranch, getMe } from "./api";
import type { Me } from "./contracts";

type Role = Me["branchAccess"][number]["role"];
const roles: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  pt: "Personal trainer",
  member: "Member",
};
const modules = [
  {
    id: "members",
    title: "Membership",
    description: "Registrasi, masa aktif, dan perjalanan setiap member.",
    icon: Users,
    roles: ["owner", "admin", "member"],
  },
  {
    id: "payments",
    title: "Pembayaran",
    description: "Bukti pembayaran, verifikasi, dan aktivasi membership.",
    icon: Wallet,
    roles: ["owner", "admin"],
  },
  {
    id: "exercises",
    title: "Panduan gerakan",
    description: "Kenali gerakan dan alat sebelum mulai latihan.",
    icon: Dumbbell,
    roles: ["owner", "admin", "pt", "member"],
  },
  {
    id: "sessions",
    title: "Program latihan",
    description: "Program personal dan jadwal pendampingan PT.",
    icon: CalendarDays,
    roles: ["pt", "member"],
  },
  {
    id: "reports",
    title: "Laporan",
    description: "Pantau aktivitas dan perkembangan bisnis gym.",
    icon: ChartNoAxesCombined,
    roles: ["owner"],
  },
];
function Brand() {
  return (
    <div className="brand">
      <Dumbbell aria-hidden="true" />
      <span>
        PREPS<span className="brand-sub">FITNESS CLUB</span>
      </span>
    </div>
  );
}
function Message({ error }: { error: unknown }) {
  return (
    <div className="error" role="alert">
      {errorText(error)}
      {error instanceof ApiError && error.requestId && (
        <small>Referensi: {error.requestId}</small>
      )}
    </div>
  );
}
function App() {
  const [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>(null),
    [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const generation = useRef(0);
  const signingOut = useRef(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const reset = () => {
    setMe(null);
    setBranchId("");
  };
  async function refresh(background = false) {
    const ticket = ++generation.current;
    if (signingOut.current) return;
    if (!background) setLoading(true);
    setCheckingSession(background);
    setError(null);
    try {
      const user = await getMe();
      if (ticket !== generation.current) return;
      setMe(user);
      setBranchId((old) =>
        user.branchAccess.some((b) => b.branchId === old)
          ? old
          : user.branchAccess[0]?.branchId || "",
      );
    } catch (e) {
      if (ticket !== generation.current) return;
      const denied =
        e instanceof ApiError && (e.status === 401 || e.status === 403);
      if (!background || denied) reset();
      if (e instanceof ApiError && e.status === 401)
        setNotice("Sesi berakhir. Silakan masuk kembali.");
      else setError(e);
    } finally {
      if (ticket === generation.current) {
        setLoading(false);
        setCheckingSession(false);
      }
    }
  }
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      generation.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  async function logout() {
    signingOut.current = true;
    setCheckingSession(false);
    setBusy(true);
    setError(null);
    generation.current++;
    reset();
    setLoading(false);
    try {
      const result = await auth.signOut();
      if (result.error) throw new Error("logout");
      setNotice("Berhasil keluar.");
    } catch {
      setError(new ApiError(0, "NETWORK_ERROR"));
      setNotice(
        "Logout belum terkonfirmasi. Coba keluar lagi untuk mengakhiri sesi di server.",
      );
    } finally {
      signingOut.current = false;
      setBusy(false);
    }
  }
  function sessionError(e: unknown) {
    generation.current++;
    reset();
    setLoading(false);
    if (e instanceof ApiError && e.status === 401) {
      setNotice("Sesi berakhir. Silakan masuk kembali.");
      setError(null);
    } else setError(e);
  }
  if (loading)
    return (
      <div className="loading">
        <Brand />
        <div className="loader" />
        <p>Memeriksa akses akun…</p>
      </div>
    );
  if (!me)
    return (
      <Login
        onLogin={refresh}
        error={error}
        notice={notice}
        logout={logout}
        busy={busy}
      />
    );
  return (
    <Shell
      key={`${me.gymId}:${me.user.id}`}
      me={me}
      branchId={branchId}
      selectBranch={setBranchId}
      logout={logout}
      busy={busy}
      onSessionError={sessionError}
      checkingSession={checkingSession}
      sessionWarning={error}
      retrySession={() => void refresh(true)}
    />
  );
}
function Login({
  onLogin,
  error,
  notice,
  logout,
  busy,
}: {
  onLogin: () => Promise<void>;
  error: unknown;
  notice: string;
  logout: () => Promise<void>;
  busy: boolean;
}) {
  const [pending, setPending] = useState(false),
    [loginError, setLoginError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setLoginError("");
    const data = new FormData(e.currentTarget);
    try {
      const result = await auth.signIn.email({
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      if (result.error) {
        setLoginError(
          result.error.status === 429
            ? "Terlalu banyak percobaan. Tunggu sebentar sebelum masuk kembali."
            : "Tidak dapat masuk. Periksa email dan kata sandi.",
        );
        return;
      }
      await onLogin();
    } catch {
      setLoginError("Tidak dapat terhubung. Periksa koneksi dan coba lagi.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="login">
      <section className="login-art">
        <Brand />
        <div className="art-grid" aria-hidden="true" />
        <div className="art-number" aria-hidden="true">
          01
        </div>
        <div className="login-statement">
          <p className="eyebrow">SHOW UP. PUT IN THE WORK.</p>
          <h1>
            BUILT ON
            <br />
            <span>CONSISTENCY.</span>
          </h1>
          <p>
            Satu tempat untuk latihan, progres,
            <br />
            dan langkah berikutnya.
          </p>
        </div>
        <div className="art-footer">
          <span>PREPS / FITNESS CLUB</span>
          <span>STRONGER. EVERY DAY.</span>
        </div>
      </section>
      <section className="login-form">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="form-inner">
          <p className="eyebrow">YOUR NEXT REP STARTS HERE</p>
          <h2>
            SELAMAT DATANG
            <br />
            KEMBALI.
          </h2>
          <p className="muted">Masuk dengan akun yang terdaftar di gym kamu.</p>
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {!!error && <Message error={error} />}
          {loginError && (
            <p className="error" role="alert">
              {loginError}
            </p>
          )}
          <form onSubmit={submit}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="nama@email.com"
                required
                disabled={pending}
              />
            </label>
            <label>
              Kata sandi
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Masukkan kata sandi"
                required
                disabled={pending}
              />
            </label>
            <button className="primary" disabled={pending || busy}>
              {pending ? "Memproses…" : "Masuk ke akun"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="help">
            Belum punya akun atau perlu bantuan masuk?
            <br />
            Hubungi admin gym kamu.
          </p>
          {(!!error || notice.includes("belum terkonfirmasi")) && (
            <button className="text-button" disabled={busy} onClick={logout}>
              Keluar dari sesi saat ini
            </button>
          )}
          <div className="secure">
            <ShieldCheck size={16} />
            Akses aman. Progres milik kamu.
          </div>
        </div>
        <span className="copyright">
          © {new Date().getFullYear()} PREPS FITNESS CLUB
        </span>
      </section>
    </main>
  );
}
function Shell({
  me,
  branchId,
  selectBranch,
  logout,
  busy,
  onSessionError,
  checkingSession,
  sessionWarning,
  retrySession,
}: {
  me: Me;
  branchId: string;
  selectBranch: (id: string) => void;
  logout: () => Promise<void>;
  busy: boolean;
  onSessionError: (e: unknown) => void;
  checkingSession: boolean;
  sessionWarning: unknown;
  retrySession: () => void;
}) {
  const [branch, setBranch] = useState<{ id: string; name: string } | null>(
      null,
    ),
    [branchError, setBranchError] = useState<unknown>(null),
    [retry, setRetry] = useState(0),
    [page, setPage] = useState("overview"),
    [menu, setMenu] = useState(false);
  const role = me.branchAccess.find((b) => b.branchId === branchId)?.role;
  useEffect(() => {
    const controller = new AbortController();
    setBranch(null);
    setBranchError(null);
    setPage("overview");
    if (branchId)
      getBranch(branchId, controller.signal)
        .then(setBranch)
        .catch((e) => {
          if (controller.signal.aborted) return;
          if (e instanceof ApiError && (e.status === 401 || e.status === 403))
            onSessionError(e);
          else setBranchError(e);
        });
    return () => controller.abort();
  }, [branchId, retry]);
  const available = modules.filter((m) => role && m.roles.includes(role));
  const selected = available.find((m) => m.id === page);
  const date = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const go = (id: string) => {
    setPage(id);
    setMenu(false);
  };
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        Lewati navigasi
      </a>
      {menu && (
        <button
          className="backdrop"
          aria-label="Tutup navigasi"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <Brand />
        <button
          className="close-nav icon-button"
          aria-label="Tutup navigasi"
          onClick={() => setMenu(false)}
        >
          <X />
        </button>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Navigasi utama">
          <button
            className={page === "overview" ? "nav-item active" : "nav-item"}
            onClick={() => go("overview")}
            aria-current={page === "overview" ? "page" : undefined}
          >
            <LayoutDashboard size={19} />
            Ringkasan
            <span className="active-dot" />
          </button>
          {available.map((m) => (
            <button
              key={m.id}
              className={page === m.id ? "nav-item active" : "nav-item"}
              onClick={() => go(m.id)}
              aria-current={page === m.id ? "page" : undefined}
            >
              <m.icon size={19} />
              {m.title}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="club-tag">
            <span className="gold-line" />
            <p>
              THE WORK
              <br />
              <strong>STARTS HERE.</strong>
            </p>
            <Dumbbell size={28} />
          </div>
          <div className="account">
            <span className="avatar">
              {me.user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{me.user.name}</strong>
              <small>{role ? roles[role] : "Belum ada cabang"}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Keluar"
              disabled={busy}
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              aria-label="Buka navigasi"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Menu />
            </button>
            <span className="topbar-title">
              WORKSPACE <span>/</span> {selected?.title || "Ringkasan"}
            </span>
          </div>
          <div className="branch-picker">
            <Building2 size={17} />
            <label className="sr-only" htmlFor="branch">
              Cabang aktif
            </label>
            <select
              id="branch"
              value={branchId}
              onChange={(e) => selectBranch(e.target.value)}
              disabled={!me.branchAccess.length}
            >
              {!me.branchAccess.length && (
                <option value="">Belum ada cabang</option>
              )}
              {[...new Set(me.branchAccess.map((b) => b.branchId))].map(
                (id) => (
                  <option key={id} value={id}>
                    {me.branchAccess.find((access) => access.branchId === id)
                      ?.branchName || "Nama cabang tidak tersedia"}
                  </option>
                ),
              )}
            </select>
            <ChevronDown size={14} />
          </div>
        </header>
        <main id="main">
          {checkingSession && (
            <p className="muted" role="status">
              Memeriksa sesi…
            </p>
          )}
          {!!sessionWarning && (
            <div>
              <Message error={sessionWarning} />
              <button className="secondary" onClick={retrySession}>
                Periksa sesi lagi
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {role ? `${roles[role]} WORKSPACE` : "WORKSPACE"}
              </p>
              <h1>{selected?.title.toUpperCase() || "SIAP UNTUK HARI INI."}</h1>
              <p className="muted">
                {selected
                  ? "Kelola aktivitas gym dalam satu tempat."
                  : `Selamat datang, ${me.user.name.split(" ")[0]}. Fokus pada langkah berikutnya.`}
              </p>
            </div>
            <span className="date">{date}</span>
          </div>
          {branchError ? (
            <>
              <Message error={branchError} />
              <button
                className="secondary"
                onClick={() => setRetry((x) => x + 1)}
              >
                <RefreshCw size={16} />
                Coba lagi
              </button>
            </>
          ) : !branchId ? (
            <Empty
              title="BELUM ADA AKSES CABANG"
              text="Hubungi admin gym untuk mendapatkan akses cabang."
            />
          ) : !branch || branch.id !== branchId ? (
            <p role="status">Memuat cabang…</p>
          ) : selected ? (
            <Empty
              title={`${selected.title.toUpperCase()} SEGERA HADIR`}
              text="Fitur ini belum tersedia di gym kamu. Admin akan memberi tahu saat layanan sudah dibuka."
            />
          ) : (
            <>
              <section className="hero">
                <div>
                  <p className="eyebrow">{branch.name}</p>
                  <h2>
                    MAKE EVERY
                    <br />
                    <span>SESSION COUNT.</span>
                  </h2>
                  <p>
                    Bangun kebiasaan. Jaga konsistensi.
                    <br />
                    Lanjutkan progres, satu sesi setiap waktu.
                  </p>
                  <span className="hero-label">
                    <span /> AKUN TERHUBUNG
                  </span>
                </div>
                <div className="weight-art" aria-hidden="true">
                  <div className="weight-circle">
                    <Dumbbell strokeWidth={1} size={116} />
                    <span>PREPS</span>
                  </div>
                  <span className="weight-caption">
                    DISCIPLINE / CONSISTENCY / PROGRESS
                  </span>
                </div>
              </section>
              <div className="section-heading">
                <h2>RUANG AKTIVITAS</h2>
                <span>Disesuaikan dengan akses kamu</span>
              </div>
              <div className="module-grid">
                {available.map((m, i) => (
                  <button
                    className="module-card"
                    key={m.id}
                    onClick={() => go(m.id)}
                  >
                    <div className="card-top">
                      <m.icon size={23} />
                      <span>0{i + 1}</span>
                    </div>
                    <h3>{m.title}</h3>
                    <p>{m.description}</p>
                    <div className="card-bottom">
                      <span>Segera hadir</span>
                      <ArrowUpRight size={20} />
                    </div>
                  </button>
                ))}
              </div>
              <section className="access-note">
                <ShieldCheck size={22} />
                <div>
                  <h3>Akun terhubung, akses sesuai layanan.</h3>
                  <p>
                    {me.entitlements.length
                      ? "Layanan mengikuti benefit yang diberikan gym."
                      : "Belum ada benefit membership aktif yang tersedia untuk akun ini. Hubungi admin untuk informasi layanan."}
                  </p>
                </div>
              </section>
            </>
          )}
          <footer className="workspace-footer">
            <span>PREPS FITNESS CLUB</span>
            <span>STRONGER. EVERY DAY.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section className="empty">
      <LockKeyhole size={35} />
      <p className="eyebrow">LAYANAN GYM</p>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
