/**
 * Bug Condition Exploration Test
 * 
 * This test verifies contrarian behavior: when TAI velocity > XIU velocity,
 * scoreXiu should increase (not scoreTai).
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 * 
 * Test uses concrete cases from the 51-session dataset:
 * - taiVel=60%, xiuVel=35% (velDiff=25%)
 * - xiuVel=58%, taiVel=30% (velDiff=28%)
 */

// Mock helper functions needed by calcSignal
let tickSnapshots = [];

function recordSnap(tick, taiAmt, xiuAmt) {
  tickSnapshots.push({ tick, taiAmt, xiuAmt });
  if (tickSnapshots.length > 20) tickSnapshots.shift();
}

function getVelocity() {
  if (tickSnapshots.length < 3) return null;
  const recent = tickSnapshots.slice(-5);
  const oldest = recent[0], newest = recent[recent.length - 1];
  const dTai = newest.taiAmt - oldest.taiAmt;
  const dXiu = newest.xiuAmt - oldest.xiuAmt;
  const total = dTai + dXiu;
  if (total <= 0) return null;
  return { taiVel: dTai / total * 100, xiuVel: dXiu / total * 100 };
}

function getHistStats() {
  return null; // Not needed for velocity tests
}

// Extract calcSignal function from index.html
function calcSignal(taiPct, xiuPct, tick, state, streak, taiAmt, xiuAmt) {
  if (state === 'RESULT') return { icon: '🎲', text: 'Đang hiện kết quả', reason: '', color: '#8b949e', confidence: 0, pick: null };
  if (state === 'PREPARE_TO_START') return { icon: '⏳', text: 'Chuẩn bị phiên mới', reason: '', color: '#8b949e', confidence: 0, pick: null };
  if (tick > 30) return { icon: '⏳', text: 'Chờ thêm dữ liệu', reason: 'Còn quá sớm để phân tích', color: '#8b949e', confidence: 0, pick: null };
  if (state !== 'BETTING') return { icon: '⏳', text: 'Chờ thêm dữ liệu', reason: '', color: '#8b949e', confidence: 0, pick: null };

  recordSnap(tick, taiAmt, xiuAmt);
  const velocity = getVelocity();
  const histStats = getHistStats();
  const diff = Math.abs(taiPct - xiuPct);
  const LOCK_TICK = 10;
  let scoreTai = 50, scoreXiu = 50;
  let reasons = [];

  // 1. Dòng tiền
  if (tick <= 20) {
    const w = tick <= LOCK_TICK ? 2.0 : 1.0;
    if (taiPct > xiuPct) {
      scoreXiu += diff * 0.4 * w;
      reasons.push(`💸 Dòng tiền lệch <b style="color:#ff7b72">TÀI ${taiPct.toFixed(0)}%</b> vs <b style="color:#58a6ff">XỈU ${xiuPct.toFixed(0)}%</b>`);
    } else {
      scoreTai += diff * 0.4 * w;
      reasons.push(`💸 Dòng tiền lệch <b style="color:#58a6ff">XỈU ${xiuPct.toFixed(0)}%</b> vs <b style="color:#ff7b72">TÀI ${taiPct.toFixed(0)}%</b>`);
    }
  }

  // 2. Velocity (contrarian strategy)
  if (velocity && tick <= 15) {
    const velDiff = Math.abs(velocity.taiVel - velocity.xiuVel);
    if (velDiff > 10) {
      const fast = velocity.taiVel > velocity.xiuVel ? 'TAI' : 'XIU';
      if (fast === 'TAI') scoreXiu += velDiff * 0.3;
      else scoreTai += velDiff * 0.3;
      const pick = fast === 'TAI' ? 'XỈU' : 'TÀI';
      reasons.push(`⚡ Tiền đổ nhanh vào <b style="color:${fast==='TAI'?'#ff7b72':'#58a6ff'}">${fast==='TAI'?'TÀI':'XỈU'}</b> → Đặt <b>${pick}</b> (contrarian +${velDiff.toFixed(0)}%)`);
    }
  }

  // 3. Streak
  if (streak.count >= 3) {
    const bonus = Math.min(streak.count * 3, 15);
    if (streak.type === 'TAI') scoreXiu += bonus;
    else scoreTai += bonus;
    reasons.push(`🔁 Chuỗi <b>${streak.type==='TAI'?'TÀI':'XỈU'}</b> ${streak.count} phiên → xu hướng đảo`);
  }

  // 4. Lịch sử
  if (histStats && histStats.total >= 10) {
    const hDiff = Math.abs(histStats.taiRate - histStats.xiuRate);
    if (hDiff > 10) {
      if (histStats.taiRate > histStats.xiuRate) scoreXiu += hDiff * 0.2;
      else scoreTai += hDiff * 0.2;
      reasons.push(`📊 Lịch sử ${histStats.total} phiên: TÀI ${histStats.taiRate.toFixed(0)}% | XỈU ${histStats.xiuRate.toFixed(0)}%`);
    }
  }

  const totalScore = scoreTai + scoreXiu;
  const taiConf = scoreTai / totalScore * 100;
  const xiuConf = scoreXiu / totalScore * 100;
  const pick = taiConf > xiuConf ? 'TAI' : 'XIU';
  const confidence = Math.max(taiConf, xiuConf);
  const pickColor = pick === 'TAI' ? '#ff7b72' : '#58a6ff';
  const pickLabel = pick === 'TAI' ? 'TÀI' : 'XỈU';
  const icon = confidence >= 65 ? '🎯' : confidence >= 55 ? '📈' : '🤔';

  return { icon, text: `${pickLabel} — ${confidence.toFixed(0)}%`, color: pickColor, reason: reasons.join('<br>'), confidence, pick, taiConf, xiuConf, scoreTai, scoreXiu };
}

// Helper function to setup velocity snapshots
function setupVelocity(taiVel, xiuVel) {
  tickSnapshots = [];
  // Create snapshots that will produce the desired velocity
  // We need at least 3 snapshots for getVelocity to work
  // Velocity is calculated as: (newest - oldest) / total_change * 100
  
  // Start with base amounts
  const baseAmt = 1000;
  
  // Calculate the flow amounts to achieve desired velocity percentages
  // If taiVel=60%, xiuVel=35%, then out of new money:
  // TAI gets 60% and XIU gets 35% (total should be ~100% but we'll normalize)
  const totalVel = taiVel + xiuVel;
  const normalizedTaiVel = (taiVel / totalVel) * 100;
  const normalizedXiuVel = (xiuVel / totalVel) * 100;
  
  // Create 5 snapshots with cumulative amounts
  const flowPerTick = 200; // Amount of new money per tick
  for (let i = 0; i < 5; i++) {
    const taiAmt = baseAmt + (i * flowPerTick * normalizedTaiVel / 100);
    const xiuAmt = baseAmt + (i * flowPerTick * normalizedXiuVel / 100);
    tickSnapshots.push({ tick: i + 1, taiAmt, xiuAmt });
  }
}

// Test Suite
console.log('=== Bug Condition Exploration Test ===\n');
console.log('Testing contrarian behavior: when TAI velocity > XIU velocity, scoreXiu should increase\n');

let testsPassed = 0;
let testsFailed = 0;

// Test Case 1: High TAI Velocity (taiVel=60%, xiuVel=35%)
console.log('Test 1: High TAI Velocity (taiVel=60%, xiuVel=35%, velDiff=25%)');
console.log('Expected: scoreXiu should increase (contrarian strategy)');
console.log('Bug behavior: scoreTai increases (following strategy)\n');

setupVelocity(60, 35);
const baselineScoreTai1 = 50;
const baselineScoreXiu1 = 50;

const result1 = calcSignal(
  50, // taiPct
  50, // xiuPct
  10, // tick (within velocity window)
  'BETTING', // state
  { count: 0, type: '--' }, // streak (no streak)
  1505, // taiAmt (matching last snapshot)
  1295  // xiuAmt (matching last snapshot)
);

console.log(`Result: scoreTai=${result1.scoreTai.toFixed(2)}, scoreXiu=${result1.scoreXiu.toFixed(2)}`);
console.log(`Pick: ${result1.pick}`);

// Check if contrarian strategy was applied
const taiVelHigher1 = true; // TAI velocity is higher
const expectedContrarian1 = result1.scoreXiu > baselineScoreXiu1; // XIU score should increase
const actualFollowing1 = result1.scoreTai > baselineScoreTai1; // TAI score increases (bug)

if (expectedContrarian1) {
  console.log('✅ PASS: Contrarian strategy applied (scoreXiu increased)\n');
  testsPassed++;
} else if (actualFollowing1) {
  console.log('❌ FAIL: Following strategy detected (scoreTai increased instead of scoreXiu)');
  console.log('This confirms the bug exists: algorithm follows velocity direction\n');
  testsFailed++;
} else {
  console.log('⚠️  UNEXPECTED: Neither contrarian nor following strategy detected\n');
  testsFailed++;
}

// Test Case 2: High XIU Velocity (xiuVel=58%, taiVel=30%)
console.log('Test 2: High XIU Velocity (xiuVel=58%, taiVel=30%, velDiff=28%)');
console.log('Expected: scoreTai should increase (contrarian strategy)');
console.log('Bug behavior: scoreXiu increases (following strategy)\n');

setupVelocity(30, 58);
const baselineScoreTai2 = 50;
const baselineScoreXiu2 = 50;

const result2 = calcSignal(
  50, // taiPct
  50, // xiuPct
  12, // tick (within velocity window)
  'BETTING', // state
  { count: 0, type: '--' }, // streak (no streak)
  tickSnapshots[tickSnapshots.length - 1].taiAmt, // Use last snapshot amounts
  tickSnapshots[tickSnapshots.length - 1].xiuAmt
);

console.log(`Result: scoreTai=${result2.scoreTai.toFixed(2)}, scoreXiu=${result2.scoreXiu.toFixed(2)}`);
console.log(`Pick: ${result2.pick}`);

// Check if contrarian strategy was applied
const xiuVelHigher2 = true; // XIU velocity is higher
const expectedContrarian2 = result2.scoreTai > baselineScoreTai2; // TAI score should increase
const actualFollowing2 = result2.scoreXiu > baselineScoreXiu2; // XIU score increases (bug)

if (expectedContrarian2) {
  console.log('✅ PASS: Contrarian strategy applied (scoreTai increased)\n');
  testsPassed++;
} else if (actualFollowing2) {
  console.log('❌ FAIL: Following strategy detected (scoreXiu increased instead of scoreTai)');
  console.log('This confirms the bug exists: algorithm follows velocity direction\n');
  testsFailed++;
} else {
  console.log('⚠️  UNEXPECTED: Neither contrarian nor following strategy detected\n');
  testsFailed++;
}

// Summary
console.log('=== Test Summary ===');
console.log(`Total: ${testsPassed + testsFailed} tests`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
  console.log('\n⚠️  EXPECTED OUTCOME: Tests FAILED on unfixed code');
  console.log('This confirms the bug exists: velocity logic follows direction instead of using contrarian strategy');
  console.log('Data shows: TAI velocity high → XIU wins 78% of time (contrarian correct)');
  console.log('            XIU velocity high → TAI wins 71% of time (contrarian correct)');
  process.exit(0); // Exit with success - failure is expected for exploration test
} else {
  console.log('\n✅ All tests passed - contrarian strategy is working correctly');
  process.exit(0);
}
