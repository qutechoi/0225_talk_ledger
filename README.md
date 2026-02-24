# 0225_talk_ledger

말로 쓰는 가계부 (React + Vite)

## 기능
- 자유문장 입력 → Gemini API로 수입/지출 판별
- 주요 팩터 추출(카테고리, 상호, 결제수단, 키워드 등)
- 결과를 JSON으로 저장/표시
- 기록 누적 저장(localStorage)로 재입력 시 이어쓰기
- Excel(.xlsx) 다운로드
- **월별 시트 분리 엑셀 생성** (`All` + `YYYY-MM` 시트)
- **카테고리별 차트** (지출 Bar, 수입/지출 Pie)
- **수동 수정 UI** (잘못 분류된 항목 편집)

## 스크린샷 / 데모 GIF
아래 경로에 파일을 두면 README에서 바로 보입니다.

- 스크린샷: `docs/screenshot-main.png`
- 데모 GIF: `docs/demo.gif`

```md
![앱 스크린샷](docs/screenshot-main.png)
![데모 GIF](docs/demo.gif)
```

![앱 스크린샷](docs/screenshot-main.png)
![데모 GIF](docs/demo.gif)

> 아직 파일이 없다면 먼저 생성해서 `docs/` 폴더에 넣어주세요.

## 실행
```bash
npm install
npm run dev
```

## 환경변수
프로젝트 루트에 `.env` 생성:
```bash
VITE_GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

## 입력 예시
- `점심 김치찌개 9500원 카드 결제`
- `프리랜서 원고료 30만원 입금`

## 주의
- Gemini 응답 포맷이 깨질 수 있어, 운영 시 서버 프록시/검증 로직 추가 권장
- 현재 통화 합계는 KRW 기준 단순 합산 표시