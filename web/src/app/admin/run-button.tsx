"use client";

// 「지금 돌리기」. 누르면 GitHub 워크플로가 걸리고, 결과 한 줄이 버튼 옆에 남는다.
// 파이프라인이 다 돌아 ingest_log에 기록이 남기까지는 몇 분 걸린다 — 눌렀다고 숫자가
// 바로 바뀌지 않는 게 정상이라, 실행 목록으로 가는 링크를 같이 둔다.
import { useActionState } from "react";
import { runJob, type ActionState } from "./actions";

export function RunButton({ job, label, runsUrl }: { job: string; label: string; runsUrl: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(runJob, null);
  return (
    <form action={action} className="adm-run">
      <input type="hidden" name="job" value={job} />
      <button type="submit" disabled={pending}>
        {pending ? "부르는 중" : `${label} 돌리기`}
      </button>
      {state && (
        <span className={state.ok ? "adm-run-msg" : "adm-run-msg no"} role="status">
          {state.message}
          {state.ok && runsUrl && (
            <a href={runsUrl} target="_blank" rel="noreferrer">
              실행 목록
            </a>
          )}
        </span>
      )}
    </form>
  );
}
