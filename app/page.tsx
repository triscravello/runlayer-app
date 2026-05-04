export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">

      <div className="text-center space-y-4 max-w-2xl">
        <h1 className="text-4xl font-semibold">
          Know Exactly What to Wear for Every Run
          <br />
          Run With RunLayer
        </h1>

        <p className="text-gray-500">
          Personalized gear recommendations based on your workout, weather, and intensity.
        </p>
      </div>

      <a href="/dashboard" className="mt-8 px-6 py-3 rounded-xl bg-black text-white">Build My Run Outfit</a>

      <div className="mt-12 p-6 rounded-2xl shadow-sm border max-w-md">
        <p className="text-sm text-gray-500">Example Recommendation</p>

        <ul className="mt-3 space-y-1">
          <li>Top: Bandit Micromesh Run Tee</li>
          <li>Bottom: Nike Aeroswift Running Shorts</li>
        </ul>
      </div>
    </main>
  );
}