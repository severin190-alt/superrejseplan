export function StrategicWaitBox({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-yellow-300/30 bg-yellow-200/10 p-4 text-sm text-yellow-100">
      {message}
    </div>
  );
}
