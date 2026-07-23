import { useEffect, useRef } from "react";
import { isChsCurrent } from "./chsStations";
import type { OfflineSyncView } from "./useOfflineSync";
import type { StationJob } from "./offlineSync";

const STATUS_TEXT: Record<StationJob["status"], string> = {
  pending: "Waiting",
  downloading: "Downloading…",
  ready: "Offline ✓",
  failed: "Failed",
  paused: "Paused",
};

function Row({ job, view }: { job: StationJob; view: OfflineSyncView }) {
  const canRestart = job.status === "failed" || job.status === "paused";
  return (
    <li className="offline-row">
      <span className="offline-row-name">{job.station.name}</span>
      <span className="offline-row-status">{STATUS_TEXT[job.status]}</span>
      {canRestart ? (
        <button onClick={() => view.restart(job.station.id)}>Restart</button>
      ) : (
        <button onClick={() => view.pause(job.station.id)} disabled={job.status === "ready"}>
          Pause
        </button>
      )}
    </li>
  );
}

export function OfflineManager({
  open,
  view,
  onClose,
}: {
  open: boolean;
  view: OfflineSyncView;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const currents = view.jobs.filter((j) => isChsCurrent(j.station));
  const tides = view.jobs.filter((j) => !isChsCurrent(j.station));
  const through = view.through.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <dialog ref={ref} className="offline-manager" onClose={onClose}>
      <div className="settings-head">
        <h2>Offline downloads</h2>
        <button className="done" onClick={onClose}>
          Done
        </button>
      </div>

      <p className="offline-through">
        {view.complete ? "Offline-ready through " : "Downloading through "}
        {through} · {view.ready}/{view.total}
      </p>

      <div className="offline-actions">
        {view.paused ? (
          <button onClick={view.resumeAll}>Resume all</button>
        ) : (
          <button onClick={view.pauseAll}>Pause all</button>
        )}
        <button onClick={view.restartAll}>Restart all</button>
      </div>

      {currents.length > 0 && (
        <>
          <p className="eyebrow">Currents</p>
          <ul className="offline-list">
            {currents.map((j) => (
              <Row key={j.station.id} job={j} view={view} />
            ))}
          </ul>
        </>
      )}
      {tides.length > 0 && (
        <>
          <p className="eyebrow">Tides</p>
          <ul className="offline-list">
            {tides.map((j) => (
              <Row key={j.station.id} job={j} view={view} />
            ))}
          </ul>
        </>
      )}

      <div className="offline-foot">
        <button className="offline-clear" onClick={view.clearCache}>
          Clear cache
        </button>
      </div>
    </dialog>
  );
}
