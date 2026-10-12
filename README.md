# 하면해

친구들끼리 내기할 때 쓰는 세 가지 미니 게임을 한곳에 모은 정적 웹 앱입니다.

- **0의 주사위**: 참가자별로 주사위 두 개를 굴리고 합의 끝자리가 가장 낮은 사람을 찾습니다.
- **아무나 걸려라**: 항목을 추가하고 원하는 수만큼 무작위로 뽑습니다.
- **팀 나누기**: 참가자와 팀 수를 입력하고, 같은 팀이 되면 안 되는 조합을 피해 팀을 나눕니다.

별도 설치 없이 `index.html`을 열어 사용할 수 있습니다. 로컬 서버가 필요하면 프로젝트 폴더에서 아래 명령을 실행하세요.

```bash
python3 -m http.server 4173
```

브라우저에서 `http://localhost:4173`을 열면 됩니다.

## Cloudflare Pages

프로덕션 사이트: <https://hamyeonchae-games.pages.dev/>

현재 폴더를 다시 배포하려면 Cloudflare 로그인 후 아래 명령을 실행합니다.

```bash
pnpm dlx wrangler pages deploy . --project-name hamyeonchae-games --branch main
```
