import "./index.css";

export default function App() {
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brandTitle">THE LONG MATH</div>
          <div className="brandSub">Objective arithmetic. No stories.</div>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <div className="heroMark">
            <div className="heroTitle">THE LONG MATH</div>

            <div className="formula mono">
              A = P(1 + r/n)<sup>nt</sup>
            </div>

            <div className="sigil">$</div>
          </div>

          <div className="heroText">
            <h1>Tools for people who refuse to lie to themselves.</h1>
            <p className="muted">
              Clear calculators that expose the real cost of fees,
              compounding drag, and financial narratives.
            </p>
          </div>
        </section>

        <section className="section">
          <h2>Calculators</h2>

          <a className="card" href="/advisor-cost">
            <h3>True Cost of a Financial Advisor</h3>
            <p className="muted">
              Total fees paid, lost compounding, and the real long-term cost.
            </p>
          </a>
        </section>

        <footer className="footer">
          © {new Date().getFullYear()} The Long Math
        </footer>
      </main>
    </div>
  );
}
