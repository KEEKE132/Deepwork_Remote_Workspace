---
version: 1.0.0
name: agent-comm-report-design
description: "전문적 기술 조사 보고서 디자인. 딥 인디고 캔버스, 화이트 카드 서피스, 인디고-바이올렛 프라이머리, 명확한 문서 계층, 8px 그리드 기반."
colors:
  primary: "#4F46E5"
  primary-hover: "#4338CA"
  primary-focus: "#7C6DF2"
  ink: "#1F2937"
  ink-muted: "#6B7280"
  ink-subtle: "#9CA3AF"
  canvas: "#FFFFFF"
  surface-1: "#F9FAFB"
  surface-2: "#F3F4F6"
  hairline: "#E5E7EB"
  on-primary: "#FFFFFF"
  semantic-success: "#10B981"
  semantic-overlay: "#EEF2FF"
typography:
  display-xl:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -1.0px
  display-lg:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.20
    letterSpacing: -0.5px
  display-md:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 26px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.2px
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.30
    letterSpacing: -0.1px
  body-lg:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.60
    letterSpacing: 0
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.60
    letterSpacing: 0
  body-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 13.5px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  button:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.20
    letterSpacing: 0
  eyebrow:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 12.5px
    fontWeight: 600
    lineHeight: 1.40
    letterSpacing: 0.8px
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
rounded:
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  pill: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 72px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 10px 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 10px 16px
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 10px 16px
  feature-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  code-block:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: 16px
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    height: 56px
  footer:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 24px 16px
---

## Overview

딥 인디고-바이올렛(`{colors.primary}`)을 단일 크로매틱 액센트로 사용하고, 흰색 캔버스(`{colors.canvas}`) 위에 1px 헤어라인으로 층을 만든 표면을 얹는다. 텍스트는 진한 회청 잉크(`{colors.ink}`)로 명확한 계층을 만들고, 본문 15px / 헤드라인 20px 기반의 문서형 타이포그래피를 쓴다. 8px 베이스 그리드로 리듬을 고정하고, 카드·표·코드블록에 은은한 라운딩(`{rounded.md}`~`{rounded.lg}`)을 적용한다. 깊이는 그림자 대신 표면 + 헤어라인 위계로 표현한다.

**Key Characteristics:**
- 단일 크로매틱 액센트: 인디고-바이올렛 하나만 색으로 사용
- 흰색/회색 표면 위계 + 1px 헤어라인으로 깊이 표현 (그림자 지양)
- 문서 중심 타이포그래피: Inter, 15px 본문, 넉넉한 행간(1.6)
- 8px 그리드 기반 라운딩·간격
- 표·카드·코드블록을 명확히 구분하는 데이터 보고서 스타일
- 모노스페이스는 코드·토큰·엔드포인트에만 사용

## Colors

> Source pages: 전문 기술 문서·리서치 리포트 디자인 시스템 (사용자 제출 보고서 요구사항 기반).

### Brand & Accent
- **Primary** (`{colors.primary}`): 핵심 강조색. 섹션 헤더, 인라인 링크, 핵심 키워드, 진행바, 하이라이트. **단일 액센트 원칙**.
- **Primary Hover** (`{colors.primary-hover}`): 인터랙션 hover 상태.
- **Primary Focus** (`{colors.primary-focus}`): 포커스 링.

### Surface
- **Canvas** (`{colors.canvas}`): 페이지 배경.
- **Surface-1** (`{colors.surface-1}`): 기본 카드·표 배경.
- **Surface-2** (`{colors.surface-2}`): 코드블록·중첩된 요소.
- **Hairline** (`{colors.hairline}`): 카드·표 구분선.

### Text
- **Ink** (`{colors.ink}`): 본문·헤드라인 텍스트.
- **Ink-muted** (`{colors.ink-muted}`): 보조 텍스트, 표의 부가 설명.
- **Ink-subtle** (`{colors.ink-subtle}`): 주석·푸터.
- **On-primary** (`{colors.on-primary}`): primary 배경 위 텍스트.

### Semantic
- **Success** (`{colors.semantic-success}`): 안정화·적용 완료 상태 배지.
- **Overlay** (`{colors.semantic-overlay}`): primary 배경을 얇게 깐 하이라이트 박스.

## Typography

### Font Family
- **Inter** (system-ui 대체): 본문·헤드라인. (라이선스 부담 없는 오픈소스, 시스템 폰트로 폴백)
- **모노스페이스**: `ui-monospace, SF Mono, Menlo` — 코드·토큰·엔드포인트 전용.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xl}` | 40px | 700 | 1.15 | -1.0px | 리포트 히어로 타이틀 |
| `{typography.display-lg}` | 32px | 700 | 1.20 | -0.5px | 섹션 헤더 |
| `{typography.headline}` | 20px | 600 | 1.30 | -0.1px | 카드·서브섹션 타이틀 |
| `{typography.body}` | 15px | 400 | 1.60 | 0 | 기본 본문 |
| `{typography.body-sm}` | 13.5px | 400 | 1.55 | 0 | 표 부가, 캡션 |
| `{typography.mono}` | 13px | 400 | 1.55 | 0 | 코드·토큰 |

### Principles
- 헤드라인은 가독성 우선의 촘촘한 자간(-0.5px 이내)으로 명확한 위계
- 본문은 긴 리포트 독해를 위해 충분한 행간 1.6
- 대문자·이탤릭 남용 금지, 강조는 ink-weight + primary 액센트로만

## Layout

### Spacing System
- **Base unit**: 8px.
- **Tokens**: `{spacing.xs}` 8px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 72px.

### Grid & Container
- Max content width: 1080px. 카드: desktop 3-up → tablet 2-up → mobile 1-up.
- 섹션 간 `{spacing.section}` 72px, 컴포넌트 간 `{spacing.md}` 16px.

### Whitespace Philosophy
- 정보 밀도가 높은 기술 문서이므로, 카드·표 내부보다 **섹션 사이 여백**을 크게 둬 독해 리듬을 만든다.
- 헤드라인 위 여백 > 아래 여백 (제목이 소속 요소를 이끄는 전형).

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | 캔버스 + 헤어라인 없음 | 본문·배경 |
| 1 (surface lift) | `{colors.surface-1}` + 1px `{colors.hairline}` | 기본 카드·표 |
| 2 (emphasis) | `{colors.surface-2}` + 1px `{colors.hairline}` | 코드블록·중첩 영역 |

깊이는 **그림자가 아닌 표면 위계 + 헤어라인**으로만 표현한다.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.md}` | 12px | 버튼·인라인 배지·코드블록 |
| `{rounded.lg}` | 16px | 카드·표 컨테이너 |
| `{rounded.pill}` | 9999px | 상태 배지·태그 |

## Components

### Buttons
**`button-primary`** — 핵심 CTA. 배경 `{colors.primary}`, 텍스트 `{colors.on-primary}`, 타입 `{typography.button}`, 패딩 10px 16px, 라운드 `{rounded.md}`. hover `{colors.primary-hover}`.

### Cards & Containers
**`feature-card`** — 표준 정보 카드. 배경 `{colors.surface-1}`, 텍스트 `{colors.ink}`, 패딩 24px, 라운드 `{rounded.lg}`, 1px `{colors.hairline}`.

### Code & Tokens
**`code-block`** — 코드·엔드포인트 블록. 배경 `{colors.surface-2}`, 모노 타입 `{typography.mono}`, 라운드 `{rounded.md}`.

## Do's and Don'ts

**Do**
- 단일 크로매틱 액센트인 `{colors.primary}`만 색으로 사용
- 표면 위계 + 헤어라인으로 깊이 표현 (그림자 금지)
- 모노스페이스는 코드·토큰·엔드포인트에만 적용
- 카드·표 내부 패딩과 섹션 간격은 8px 그리드 준수

**Don't**
- 다중 액센트·그라데이션·버튼 3개 이상 사용 금지
- 본문에 대문자 남용·이탤릭·밑줄 강조 금지
- 1080px 컨테이너를 넘는 콘텐츠 폭 금지
- 표에 3단 이상 중첩 또는 과도한 컬러 셀 금지

## Responsive Behavior

- **Mobile (< 768px)**: 카드·표 1-up, 본문 15px 유지, 섹션 패딩 축소(48px).
- **Tablet (768–1024px)**: 카드 2-up, 표 가로 스크롤 허용.
- **Desktop (> 1024px)**: 카드 3-up, 1080px 컨테이너, 표 전체 표시.

## Agent Prompt Guide

Quick references for generation prompts:

- **Colors**: canvas `{colors.canvas}` · ink `{colors.ink}` · primary `{colors.primary}`
- **Type**: display `{typography.display-xl}` · body `{typography.body}` · button `{typography.button}`
- **Radius**: buttons `{rounded.md}` · cards `{rounded.lg}` · pills `{rounded.pill}`

Prompt template: "Build a {report-section} for {topic}. Use DESIGN.md tokens: canvas
{colors.canvas}, primary {colors.primary}, headline {typography.headline}, card radius
{rounded.lg}, section spacing {spacing.section}. Follow the Do/Don't guardrails."