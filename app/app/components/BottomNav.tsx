export default function BottomNav() {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800 px-6 py-4 flex justify-between items-center z-50">
      <button className="flex flex-col items-center text-green-400">
        <span className="text-xl">⌂</span>
        <span className="text-xs mt-1">Scanner</span>
      </button>

      <button className="flex flex-col items-center text-gray-500">
        <span className="text-xl">📈</span>
        <span className="text-xs mt-1">Rankings</span>
      </button>

      <button className="flex flex-col items-center text-gray-500">
        <span className="text-xl">⭐</span>
        <span className="text-xs mt-1">Watchlist</span>
      </button>

      <button className="flex flex-col items-center text-gray-500">
        <span className="text-xl">⚡</span>
        <span className="text-xs mt-1">Alerts</span>
      </button>
    </div>
  );
}