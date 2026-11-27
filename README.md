# 2027 선택과목 변경 신청 (천안신당고)

- 학생 화면: https://joyeonguk.github.io/sindang-subject-change/
- 교사 화면: https://joyeonguk.github.io/sindang-subject-change/?page=teacher
- 미리보기(예시 데이터): https://joyeonguk.github.io/sindang-subject-change/?demo

## 구조
| 파일 | 역할 |
|---|---|
| `index.html` | 학생·교사 화면 (GitHub Pages) |
| `config.js` | Apps Script 연결 주소 `API_URL` (비어 있으면 미리보기로 동작) |
| `apps-script/Code.gs` | 구글 시트 연결 통로. 과목선택 DB 읽기, 변경신청 저장소에 기록 |

학생 비밀번호 확인과 저장은 모두 선생님 구글 계정의 Apps Script에서 처리합니다. GitHub에는 학생 정보가 올라가지 않습니다.

## 연결 순서 (처음 한 번)
1. https://script.google.com 에서 **새 프로젝트**를 만들고, `Code.gs` 내용을 지운 뒤 `apps-script/Code.gs`를 붙여 넣고 저장합니다.
2. **배포 → 새 배포 → 유형 선택(톱니) → 웹 앱**
   - 다음 사용자 인증 정보로 실행: **나**
   - 액세스 권한이 있는 사용자: **모든 사용자**
3. 권한 승인 창에서 계정을 고르고 허용합니다. 「확인되지 않은 앱」이 나오면 **고급 → (프로젝트 이름)(으)로 이동**을 누릅니다.
4. 나온 **웹 앱 URL**(`https://script.google.com/macros/s/…/exec`)을 `config.js`의 `API_URL`에 넣습니다.
5. 교사 화면(`?page=teacher`)을 열면 「저장소 만들기」가 나옵니다. 아래 항목을 입력합니다.
   - 교사 비밀번호
   - 과목선택 DB 스프레드시트 주소
   - 시트 이름: `천안신당고등학교 과목선택 DB`
   - 신청 기간

   이렇게 하면 드라이브에 「2027 선택과목 변경 신청 저장소」가 만들어집니다.

## 확인할 점
- 학생은 과목선택 DB A열에 적힌 학번(현재 학번, 예: 10106)과 이름, O열 비밀번호로 로그인합니다.
- 과목선택 DB는 읽기만 합니다.
- 「접수」 상태에서는 학생이 직접 수정·취소할 수 있습니다. 「상담중」 이상이 되면 수정할 수 없습니다.
- `Code.gs`를 고친 뒤에는 **배포 관리 → 연필 → 버전: 새 버전 → 배포**를 해야 반영됩니다. 이렇게 하면 주소가 바뀌지 않습니다.
- 신청 가능 과목은 `Code.gs` 맨 위 `SUBJECTS`에 있습니다.
