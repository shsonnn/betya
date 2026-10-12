# 하면해

친구들과 실시간 방을 만들고 채팅하면서 즐기는 내기 게임 웹 앱입니다.

- **0의 주사위**: 참가자별로 주사위 두 개를 굴리고 합의 끝자리가 가장 낮은 사람을 찾습니다.
- **아무나 걸려라**: 항목을 추가하고 원하는 수만큼 무작위로 뽑습니다.
- **팀 나누기**: 참가자와 팀 수를 입력하고, 같은 팀이 되면 안 되는 조합을 피해 팀을 나눕니다.

## 방과 채팅

- 처음 접속하면 방 만들기 또는 방 입장하기를 선택합니다.
- 방장은 공개/비공개, 비밀번호, 게임 종류를 정할 수 있습니다.
- 방 안에서는 참가자 프로필 배지와 인원수를 실시간으로 확인할 수 있습니다.
- 텍스트와 하면해 이모티콘 채팅을 지원합니다.
- 참가자 이름과 채팅 기록은 영구 저장하지 않으며, 모두 나가면 방 데이터가 삭제됩니다.

## 로컬 실행

Node.js 22 이상과 pnpm이 필요합니다.

```bash
pnpm install
pnpm run dev
```

브라우저에서 Wrangler가 출력하는 로컬 주소를 열면 됩니다.

## Cloudflare Workers

정적 파일은 Workers Static Assets로, 방·참여자·채팅은 Durable Objects와 WebSocket으로 동작합니다.

프로덕션 사이트: <https://betya.sonsahyeon.workers.dev>

검증과 배포 명령:

```bash
pnpm run typecheck
pnpm run build
pnpm run deploy
```
