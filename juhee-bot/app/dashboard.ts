/**
 * @fileoverview 관리자 대시보드 HTML
 * @description 단일 페이지 관리자 대시보드. 서버 자체 HTTP 서버(api.ts)에서 제공된다.
 * @author kevin1113dev
 *
 * @remarks
 * - 이 파일은 클라이언트로 전송되는 정적 HTML/CSS/JS 문자열만 담는다.
 * - 바깥 문자열이 템플릿 리터럴이므로, 내부 클라이언트 JS에서는 백틱(`)과 `${` 를 쓰지 않는다.
 *   (문자열은 작은따옴표 + 연결(+)로 작성)
 */

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>주희봇 관리 대시보드</title>
<style>
  :root {
    --bg: #0e1116; --panel: #161b22; --panel2: #1c232d; --border: #2a3441;
    --text: #e6edf3; --muted: #8b949e; --accent: #5b8cff; --good: #3fb950;
    --warn: #d29922; --bad: #f85149; --chip: #21262d;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    font-size: 14px; line-height: 1.5; }
  a { color: var(--accent); }
  header { padding: 14px 20px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px; background: var(--panel); position: sticky; top: 0; z-index: 5; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .spacer { flex: 1; }
  .btn { background: var(--panel2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 7px 12px; cursor: pointer; font-size: 13px; }
  .btn:hover { border-color: var(--accent); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.danger { border-color: var(--bad); color: var(--bad); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 18px 20px 60px; }
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; }
  .tab { padding: 8px 14px; border-radius: 8px; cursor: pointer; color: var(--muted);
    border: 1px solid transparent; }
  .tab.active { background: var(--panel); color: var(--text); border-color: var(--border); }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px; margin-bottom: 16px; }
  .panel h2 { margin: 0 0 12px; font-size: 14px; color: var(--muted); font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .stat { background: var(--panel2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .stat .label { color: var(--muted); font-size: 12px; }
  .stat .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
  .stat .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .bar { height: 8px; background: var(--chip); border-radius: 6px; overflow: hidden; margin-top: 8px; }
  .bar > i { display: block; height: 100%; background: var(--good); }
  .bar.warn > i { background: var(--warn); } .bar.bad > i { background: var(--bad); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; }
  tr:hover td { background: var(--panel2); }
  .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px;
    background: var(--chip); color: var(--muted); }
  .chip.on { background: rgba(63,185,80,.15); color: var(--good); }
  .chip.off { background: rgba(248,81,73,.15); color: var(--bad); }
  input, textarea, select { background: var(--panel2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 9px 10px; font-size: 13px; width: 100%; font-family: inherit; }
  label.field { display: block; margin-bottom: 12px; }
  label.field span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 5px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  pre.log { background: #0a0d12; border: 1px solid var(--border); border-radius: 8px; padding: 12px;
    max-height: 60vh; overflow: auto; font-size: 12px; line-height: 1.45; white-space: pre-wrap;
    word-break: break-all; font-family: ui-monospace, Menlo, Consolas, monospace; }
  .muted { color: var(--muted); }
  .toast { position: fixed; bottom: 18px; right: 18px; background: var(--panel2);
    border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; opacity: 0;
    transition: opacity .2s; z-index: 20; }
  .toast.show { opacity: 1; }
  .hidden { display: none !important; }
  /* login */
  #login { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center;
    justify-content: center; z-index: 30; }
  #login .box { background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: 28px; width: 320px; }
  #login h1 { font-size: 18px; margin: 0 0 4px; }
  #login p { color: var(--muted); margin: 0 0 18px; font-size: 13px; }
  #loginErr { color: var(--bad); font-size: 13px; min-height: 18px; margin-top: 8px; }
</style>
</head>
<body>
<div id="login">
  <div class="box">
    <h1>주희봇 관리 대시보드</h1>
    <p>관리자 비밀번호를 입력하세요.</p>
    <form id="loginForm">
      <input id="pw" type="password" placeholder="비밀번호" autocomplete="current-password" />
      <div id="loginErr"></div>
      <button class="btn primary" type="submit" style="width:100%; margin-top:12px;">로그인</button>
    </form>
  </div>
</div>

<div id="app" class="hidden">
  <header>
    <h1>🎧 주희봇 관리 대시보드</h1>
    <span class="spacer"></span>
    <span id="clock" class="muted" style="font-size:12px;"></span>
    <button class="btn" id="refreshBtn">새로고침</button>
    <button class="btn danger" id="logoutBtn">로그아웃</button>
  </header>
  <div class="wrap">
    <div class="tabs">
      <div class="tab active" data-tab="overview">개요</div>
      <div class="tab" data-tab="tts">TTS 캐시</div>
      <div class="tab" data-tab="servers">서버 목록</div>
      <div class="tab" data-tab="logs">로그</div>
      <div class="tab" data-tab="actions">관리 액션</div>
    </div>

    <section id="tab-overview">
      <div class="panel"><h2>봇 상태</h2><div class="grid" id="botStats"></div></div>
      <div class="panel"><h2>시스템 리소스</h2><div class="grid" id="sysStats"></div></div>
      <div class="panel"><h2>샤드별 서버 수</h2><div id="shardTable"></div></div>
    </section>

    <section id="tab-tts" class="hidden">
      <div class="panel"><h2>TTS 캐시 통계</h2><div class="grid" id="ttsStats"></div></div>
    </section>

    <section id="tab-servers" class="hidden">
      <div class="panel"><h2>서버 목록 <span id="serverCount" class="muted"></span></h2><div id="serverTable"></div></div>
    </section>

    <section id="tab-logs" class="hidden">
      <div class="panel"><h2>로그 파일</h2><div id="logList"></div></div>
      <div class="panel"><h2>로그 내용 <span id="logName" class="muted"></span></h2>
        <div class="row" style="margin-bottom:10px;">
          <button class="btn" id="logReload">다시 불러오기</button>
          <button class="btn" id="logDownload">다운로드</button>
          <span class="muted" id="logHint">파일을 선택하세요 (마지막 부분만 표시)</span>
        </div>
        <pre class="log" id="logView">(선택된 파일 없음)</pre>
      </div>
    </section>

    <section id="tab-actions" class="hidden">
      <div class="panel"><h2>공지 전송</h2>
        <p class="muted">TTS 채널이 설정된 모든 서버로 공지 임베드를 보냅니다.</p>
        <label class="field"><span>제목</span><input id="noticeTitle" placeholder="공지 제목" /></label>
        <label class="field"><span>내용</span><textarea id="noticeBody" rows="5" placeholder="공지 내용"></textarea></label>
        <button class="btn primary" id="noticeSend">공지 전송</button>
      </div>
      <div class="panel"><h2>언어 인식 토글</h2>
        <div class="row">
          <button class="btn" id="toggleRecognize">recognizeOption 토글</button>
          <span id="recognizeState" class="chip">상태 불명</span>
        </div>
      </div>
    </section>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var currentLog = null; // { folder, file }

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function fmtBytes(n) {
    if (n == null) return '-';
    var u = ['B', 'KB', 'MB', 'GB', 'TB']; var i = 0; var v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
  }
  function fmtNum(n) { return (n == null ? '-' : Number(n).toLocaleString()); }
  function fmtDur(sec) {
    if (sec == null) return '-';
    sec = Math.floor(sec);
    var d = Math.floor(sec / 86400); sec -= d * 86400;
    var h = Math.floor(sec / 3600); sec -= h * 3600;
    var m = Math.floor(sec / 60); sec -= m * 60;
    var out = '';
    if (d) out += d + '일 ';
    if (h || d) out += h + '시간 ';
    out += m + '분';
    return out;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) { showLogin(); throw new Error('unauthorized'); }
      return r;
    });
  }

  // ---------- login ----------
  function showLogin() { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); }
  function showApp() { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginErr').textContent = '';
    var body = 'password=' + encodeURIComponent($('pw').value);
    fetch('/admin/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body
    }).then(function (r) {
      if (r.ok) { $('pw').value = ''; showApp(); init(); }
      else if (r.status === 429) { $('loginErr').textContent = '시도가 너무 많습니다. 잠시 후 다시 시도하세요.'; }
      else { $('loginErr').textContent = '비밀번호가 올바르지 않습니다.'; }
    }).catch(function () { $('loginErr').textContent = '로그인 요청 실패.'; });
  });

  $('logoutBtn').addEventListener('click', function () {
    api('/admin/logout', { method: 'POST' }).then(function () { showLogin(); }).catch(function () {});
  });

  // ---------- tabs ----------
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      var name = t.getAttribute('data-tab');
      ['overview', 'tts', 'servers', 'logs', 'actions'].forEach(function (n) {
        $('tab-' + n).classList.toggle('hidden', n !== name);
      });
      if (name === 'servers') loadServers();
      if (name === 'logs') loadLogs();
      if (name === 'tts') loadStats();
    });
  });

  // ---------- overview + tts ----------
  function statCard(label, value, sub) {
    return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value">' +
      value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }
  function meterCard(label, used, total, unit) {
    var pct = total > 0 ? Math.round((used / total) * 100) : 0;
    var cls = pct >= 90 ? 'bad' : (pct >= 75 ? 'warn' : '');
    return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value">' + pct + '%</div>' +
      '<div class="sub">' + (unit === 'bytes' ? fmtBytes(used) + ' / ' + fmtBytes(total) : used + ' / ' + total) + '</div>' +
      '<div class="bar ' + cls + '"><i style="width:' + pct + '%"></i></div></div>';
  }

  function loadStats() {
    return api('/admin/api/stats').then(function (r) { return r.json(); }).then(function (d) {
      // bot
      var b = '';
      b += statCard('총 서버 수', fmtNum(d.bot.totalGuilds));
      b += statCard('등록 사용자', fmtNum(d.bot.userCount));
      b += statCard('서버-사용자 관계', fmtNum(d.bot.joinCount));
      b += statCard('샤드 수', fmtNum(d.bot.shardCount));
      b += statCard('봇 가동시간', fmtDur(d.bot.uptimeSec));
      b += statCard('봇 프로세스 RSS', fmtBytes(d.bot.totalRss), '전체 샤드 합');
      $('botStats').innerHTML = b;

      // system
      var s = '';
      s += meterCard('시스템 메모리', d.system.memUsed, d.system.memTotal, 'bytes');
      if (d.system.swapTotal > 0) s += meterCard('스왑', d.system.swapUsed, d.system.swapTotal, 'bytes');
      s += statCard('CPU 로드(1분)', (d.system.load1 != null ? d.system.load1.toFixed(2) : '-'),
        d.system.cpuCount + '코어');
      s += statCard('서버 가동시간', fmtDur(d.system.osUptimeSec));
      s += statCard('Node 버전', esc(d.system.nodeVersion));
      $('sysStats').innerHTML = s;

      // shards
      var st = '<table><thead><tr><th>샤드</th><th>서버 수</th></tr></thead><tbody>';
      (d.bot.perShard || []).forEach(function (n, i) {
        st += '<tr><td>#' + i + '</td><td>' + fmtNum(n) + '</td></tr>';
      });
      st += '</tbody></table>';
      $('shardTable').innerHTML = st;

      // tts
      var t = '';
      var denom = d.tts.hits + d.tts.misses;
      var rate = denom > 0 ? ((d.tts.hits / denom) * 100).toFixed(1) + '%' : '-';
      t += statCard('히트율', rate, '히트+미스 ' + fmtNum(denom));
      t += statCard('히트', fmtNum(d.tts.hits));
      t += statCard('미스', fmtNum(d.tts.misses));
      t += statCard('동시 대기', fmtNum(d.tts.inflightWaits));
      t += statCard('오류', fmtNum(d.tts.errors));
      t += statCard('캐시 파일', fmtNum(d.tts.cacheFiles), fmtBytes(d.tts.cacheBytes));
      $('ttsStats').innerHTML = t;

      if (d.recognizeOption != null) {
        var el = $('recognizeState');
        el.textContent = d.recognizeOption ? '활성화됨' : '비활성화됨';
        el.className = 'chip ' + (d.recognizeOption ? 'on' : 'off');
      }
    });
  }

  // ---------- servers ----------
  function loadServers() {
    return api('/admin/api/servers').then(function (r) { return r.json(); }).then(function (d) {
      $('serverCount').textContent = '(' + d.servers.length + '개)';
      var h = '<table><thead><tr><th>이름</th><th>서버 ID</th><th>TTS 채널</th><th>음소거</th><th>멤버</th></tr></thead><tbody>';
      d.servers.forEach(function (sv) {
        h += '<tr><td>' + esc(sv.name) + '</td><td class="muted">' + esc(sv.id) + '</td>' +
          '<td>' + (sv.ttsChannel ? '<span class="chip on">설정됨</span>' : '<span class="chip off">미설정</span>') + '</td>' +
          '<td>' + (sv.isMuted ? '<span class="chip off">음소거</span>' : '<span class="chip">-</span>') + '</td>' +
          '<td>' + (sv.memberCount != null ? fmtNum(sv.memberCount) : '-') + '</td></tr>';
      });
      h += '</tbody></table>';
      $('serverTable').innerHTML = h;
    });
  }

  // ---------- logs ----------
  function loadLogs() {
    return api('/admin/api/logs').then(function (r) { return r.json(); }).then(function (d) {
      var h = '<table><thead><tr><th>폴더</th><th>파일</th><th>크기</th><th>수정시각</th><th></th></tr></thead><tbody>';
      d.files.forEach(function (f) {
        h += '<tr><td class="muted">' + esc(f.folder) + '</td><td>' + esc(f.name) + '</td>' +
          '<td>' + fmtBytes(f.size) + '</td><td class="muted">' + esc(f.mtime) + '</td>' +
          '<td><button class="btn" data-f="' + esc(f.folder) + '" data-n="' + esc(f.name) + '">보기</button></td></tr>';
      });
      h += '</tbody></table>';
      if (d.files.length === 0) h = '<p class="muted">로그 파일이 없습니다.</p>';
      $('logList').innerHTML = h;
      $('logList').querySelectorAll('button[data-n]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          viewLog(btn.getAttribute('data-f'), btn.getAttribute('data-n'));
        });
      });
    });
  }
  function viewLog(folder, file) {
    currentLog = { folder: folder, file: file };
    $('logName').textContent = folder + '/' + file;
    $('logView').textContent = '불러오는 중...';
    var q = '?folder=' + encodeURIComponent(folder) + '&file=' + encodeURIComponent(file);
    api('/admin/api/logs/view' + q).then(function (r) { return r.text(); }).then(function (txt) {
      $('logView').textContent = txt || '(빈 파일)';
      $('logView').scrollTop = $('logView').scrollHeight;
    }).catch(function () { $('logView').textContent = '불러오기 실패'; });
  }
  $('logReload').addEventListener('click', function () {
    if (currentLog) viewLog(currentLog.folder, currentLog.file); else toast('파일을 먼저 선택하세요');
  });
  $('logDownload').addEventListener('click', function () {
    if (!currentLog) { toast('파일을 먼저 선택하세요'); return; }
    var q = '?folder=' + encodeURIComponent(currentLog.folder) + '&file=' + encodeURIComponent(currentLog.file);
    window.location.href = '/admin/api/logs/download' + q;
  });

  // ---------- actions ----------
  $('noticeSend').addEventListener('click', function () {
    var title = $('noticeTitle').value.trim();
    var content = $('noticeBody').value;
    if (!title) { toast('제목을 입력하세요'); return; }
    if (!confirm('모든 TTS 채널에 공지를 전송할까요?')) return;
    api('/admin/api/notice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, content: content })
    }).then(function (r) { return r.json(); }).then(function (res) {
      toast('공지 전송 완료: 성공 ' + res.success + ' / 실패 ' + res.failure);
    }).catch(function () { toast('공지 전송 실패'); });
  });
  $('toggleRecognize').addEventListener('click', function () {
    api('/admin/api/toggleRecognize', { method: 'POST' })
      .then(function (r) { return r.json(); }).then(function (res) {
        var el = $('recognizeState');
        el.textContent = res.recognizeOption ? '활성화됨' : '비활성화됨';
        el.className = 'chip ' + (res.recognizeOption ? 'on' : 'off');
        toast('토글됨');
      }).catch(function () { toast('토글 실패'); });
  });

  // ---------- refresh / clock ----------
  $('refreshBtn').addEventListener('click', function () { loadStats().catch(function () {}); });
  setInterval(function () {
    var d = new Date();
    $('clock').textContent = d.toLocaleTimeString('ko-KR');
  }, 1000);
  var autoTimer = null;
  function startAuto() {
    if (autoTimer) return;
    autoTimer = setInterval(function () {
      if (!$('tab-overview').classList.contains('hidden') || !$('tab-tts').classList.contains('hidden')) {
        loadStats().catch(function () {});
      }
    }, 5000);
  }

  function init() { loadStats().then(startAuto).catch(function () {}); }

  // 최초 진입: 세션 유효하면 바로 표시, 아니면 로그인
  loadStats().then(function () { showApp(); startAuto(); })
    .catch(function () { showLogin(); });
})();
</script>
</body>
</html>`;
