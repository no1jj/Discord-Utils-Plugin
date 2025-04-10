# Plugin 설치 가이드

## 🔧 사전 준비

### 1. Node.js 설치  
- 다운로드: https://nodejs.org/en  

### 2. Git 설치  
- 다운로드: https://git-scm.com/download/win

---

## 📦 Vencord 설치 및 세팅

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
npm i -g pnpm
pnpm i
```

---

## 🧩 Plugin 설치

1. 아래 경로로 이동:
```bash
cd Vencord/src/userplugins
```

2. 아래 레포에서 플러그인을 다운로드:  
   - https://github.com/no1jj/Discord-Utils-Plugin

3. 다운로드한 JS 파일을 `src/userplugins` 디렉토리에 복사

4. 플러그인 빌드:
```bash
pnpm build
```

5. Discord에 Vencord 적용:
```bash
pnpm inject
```

---

## 📺 관련 영상

[유튜브 영상 보기](https://www.youtube.com/watch?v=3anTy0EdvsE)
