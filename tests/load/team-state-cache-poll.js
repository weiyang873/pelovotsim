import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:8787";
const TEAM_ID = __ENV.TEAM_ID || "";
const MEMBER_ID = __ENV.MEMBER_ID || "";
const LITE = String(__ENV.LITE || "1") !== "0";

export const options = {
  vus: Number(__ENV.VUS || 60),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"]
  }
};

export default function pollTeamState() {
  if (!TEAM_ID) {
    throw new Error("TEAM_ID is required");
  }
  const query = [
    `teamId=${encodeURIComponent(TEAM_ID)}`,
    MEMBER_ID ? `memberId=${encodeURIComponent(MEMBER_ID)}` : "",
    LITE ? "lite=1" : ""
  ].filter(Boolean).join("&");
  const res = http.get(`${BASE_URL}/api/round2/state?${query}`);
  check(res, {
    "state 200": (r) => r.status === 200,
    "state ok": (r) => {
      try {
        return JSON.parse(r.body || "{}").ok === true;
      } catch (_) {
        return false;
      }
    }
  });
  sleep(Number(__ENV.SLEEP || 0.2));
}
