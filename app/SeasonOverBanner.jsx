// Shown on My Entries and the Weekly Summary once the admin ends the season
// (Admin > Games & Weeks > End season).
export default function SeasonOverBanner({ message }) {
  return (
    <div
      className="rounded-lg px-4 py-3 border-l-4 mb-4"
      style={{ background: "rgba(63,166,108,0.14)", borderColor: "#3FA66C" }}
    >
      <div className="font-black uppercase tracking-wide">Season over</div>
      <div className="text-sm text-chalk/80 mt-1 whitespace-pre-wrap">
        {message || "This season is over. Thanks for playing!"}
      </div>
    </div>
  );
}
