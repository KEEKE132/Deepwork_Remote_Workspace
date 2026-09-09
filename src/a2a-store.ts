import type { Env } from "./env";
import {
  ListTasksRequest,
  ListTasksResponse,
  Task,
  TaskState,
} from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";

/**
 * KV 사서함 TaskStore.
 *
 * 메신저 허브에서 "사서함" 역할을 한다. 각 Task는 소유자(owner)별 KV에
 * 저장되어, 소유자(= 인증된 에이전트 라벨)만 자신의 사서함을 읽을 수 있다.
 * Task 자체는 일시적 대화 데이터일 뿐이며, 지식 문서(docs/*) 저장소와는
 * 완전히 분리된다.
 *
 * 키 구성: a2a:mail/<owner>/<taskId> -> Task JSON
 */
const MAIL_PREFIX = "a2a:mail:";

/** 컨텍스트에서 사서함 소유자 라벨을 유도한다 (미인증이면 anonymous) */
export function ownerOf(context: ServerCallContext): string {
  return context.user?.userName ?? "anonymous";
}

function mailKey(owner: string, taskId: string): string {
  return `${MAIL_PREFIX}${owner}/${taskId}`;
}

/**
 * TaskStore 인터페이스 구현 — 소유자(에이전트 라벨) 스코프의 KV 사서함.
 * Workers는 stateless이므로 요청 간 상태를 KV로 영속화한다.
 */
export class KvTaskStore {
  constructor(private readonly env: Env) {}

  async save(task: Task, context: ServerCallContext): Promise<void> {
    const owner = ownerOf(context);
    await this.env.KV.put(mailKey(owner, task.id), JSON.stringify(task));
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    const owner = ownerOf(context);
    const raw = await this.env.KV.get(mailKey(owner, taskId));
    return raw ? (JSON.parse(raw) as Task) : undefined;
  }

  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    const owner = ownerOf(context);
    const prefix = `${MAIL_PREFIX}${owner}/`;
    const tasks: Task[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = await this.env.KV.list({ prefix, cursor, limit: 100 });
      for (const key of result.keys) {
        const raw = await this.env.KV.get(key.name);
        if (raw) tasks.push(JSON.parse(raw) as Task);
      }
      if (result.list_complete) break;
      cursor = result.cursor;
    }

    // 필터: 대화(contextId) 및 상태(state)
    let filtered = tasks;
    if (params.contextId) {
      filtered = filtered.filter((t) => t.contextId === params.contextId);
    }
    if (params.status !== undefined && params.status !== TaskState.TASK_STATE_UNSPECIFIED && params.status !== TaskState.UNRECOGNIZED) {
      filtered = filtered.filter((t) => t.status?.state === params.status);
    }
    if (params.statusTimestampAfter) {
      const after = new Date(params.statusTimestampAfter).getTime();
      filtered = filtered.filter((t) => {
        const ts = t.status?.timestamp;
        return ts ? new Date(ts).getTime() >= after : false;
      });
    }

    // 최신순 정렬
    filtered.sort((a, b) => {
      const ta = a.status?.timestamp || "";
      const tb = b.status?.timestamp || "";
      if (tb !== ta) return tb.localeCompare(ta);
      return b.id.localeCompare(a.id);
    });

    const totalSize = filtered.length;
    const pageSize = Math.max(1, Math.min(params.pageSize ?? 50, 100));
    const start = params.pageToken ? Number(params.pageToken) || 0 : 0;
    const page = filtered.slice(start, start + pageSize);

    // includeArtifacts=false(기본)면 artifact 제거
    const resultTasks = page.map((t) => {
      const copy = structuredClone(t);
      if (!params.includeArtifacts) copy.artifacts = [];
      return copy;
    });

    return {
      tasks: resultTasks,
      nextPageToken: start + pageSize < totalSize ? String(start + pageSize) : "",
      pageSize,
      totalSize,
    };
  }

  /** 사서함에서 Task를 삭제한다 — "수신 즉시 삭제" 소비 동작 */
  async consume(taskId: string, owner: string): Promise<boolean> {
    const existed = (await this.env.KV.get(mailKey(owner, taskId))) !== null;
    await this.env.KV.delete(mailKey(owner, taskId));
    return existed;
  }
}
