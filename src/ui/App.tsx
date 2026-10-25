import { useCallback, useEffect, useMemo, useState } from 'react';
import { gameConfig as C } from '../config/gameConfig';
import type { DifficultyKey } from '../config/gameConfig';
import { sanitizeSeed } from '../engine';
import { backupInvalidSave, loadFromStorage, saveToStorage } from '../save/saveData';
import type { LoadResult } from '../save/saveData';
import {
  answerQuiz, backToDecide, choose, dismissIntro, finishQuiz, nextTurn, retryTurn, runTurn, setDraft, startSession, toPredict, undoTurn
} from '../save/session';
import type { Session } from '../save/session';
import { UiContext } from './common';
import { FinishedScreen, QuizScreen } from './EndScreens';
import { GameHeader, viewTurn } from './GameHeader';
import { Modal } from './Modals';
import type { ModalState } from './Modals';
import { DecideScreen, PredictScreen, ShortageScreen } from './PlayScreens';
import { ResultScreen } from './ResultScreen';
import { TitleScreen } from './TitleScreen';

function initialParams() {
  const params = new URLSearchParams(window.location.search);
  const diff = params.get('difficulty');
  return {
    seed: sanitizeSeed(params.get('seed')),
    difficulty: (diff && diff in C.difficulties ? diff : 'normal') as DifficultyKey,
    fresh: params.has('seed') || params.has('new')
  };
}

export function App() {
  const params = useMemo(initialParams, []);
  const [load, setLoad] = useState<LoadResult>(() => loadFromStorage());
  const [session, setSession] = useState<Session | null>(() => (!params.fresh && load.status === 'ok' ? load.session : null));
  const [notices, setNotices] = useState<string[]>(() => (load.status === 'ok' ? load.notices : []));
  const [modal, setModal] = useState<ModalState>(null);
  const [quizReviewed, setQuizReviewed] = useState(() => (load.status === 'ok' ? load.session.quizAnswers.length : 0));
  const [saveFailed, setSaveFailed] = useState(false);

  // 状態が変わるたびに保存
  useEffect(() => {
    if (session) setSaveFailed(!saveToStorage(session));
  }, [session]);
  // 画面が切り替わったら先頭へ
  const phase = session?.phase;
  const turn = session?.core.turn;
  useEffect(() => { window.scrollTo(0, 0); }, [phase, turn, session === null]);

  const update = useCallback((f: (s: Session) => Session) => setSession(s => (s ? f(s) : s)), []);
  const closeModal = useCallback(() => setModal(null), []);

  const start = (difficulty: DifficultyKey, seed: string) => {
    const go = () => {
      if (load.status === 'invalid') backupInvalidSave();
      setSession(startSession(difficulty, seed));
      setNotices([]); setQuizReviewed(0); setModal(null);
    };
    if (load.status !== 'empty' && !session) {
      setModal({ type: 'confirm', title: '新しく始めますか？', text: load.status === 'invalid' ? '読み込めなかったセーブデータは別名で退避してから、新しく始めます。' : 'いまのセーブデータは上書きされます。', okLabel: '新しく始める', onOk: go });
    } else go();
  };
  const toTitle = () => { setModal(null); setLoad(loadFromStorage()); setSession(null); };

  if (!session) {
    return (
      <div className="app">
        <TitleScreen load={params.fresh && load.status === 'ok' ? load : load} initialDiff={params.difficulty} initialSeed={params.seed}
          onStart={start} onContinue={() => { if (load.status === 'ok') { setSession(load.session); setNotices(load.notices); setQuizReviewed(load.session.quizAnswers.length); } }} />
        <Modal modal={modal} onClose={closeModal} setModal={setModal} difficulty="easy" turn={0} latest={null} menu={{ seed: '', canUndo: false, onUndo: () => {}, onTitle: toTitle, onRestart: () => {} }} />
      </div>
    );
  }

  const core = session.core;
  const d = C.difficulties[core.difficulty];
  const latest = core.history[core.history.length - 1]?.result ?? null;
  const vt = viewTurn(session);
  const restart = () => setModal({
    type: 'confirm', title: '最初からやり直しますか？', text: '同じ難易度・同じシードで1年目の春から始めます。いまの進行状況は消えます。', okLabel: '最初からやり直す',
    onOk: () => { setSession(startSession(core.difficulty, core.seed)); setQuizReviewed(0); setModal(null); }
  });

  let main;
  switch (session.phase) {
    case 'decide':
      main = <DecideScreen session={session} onDraft={dr => update(s => setDraft(s, dr))} onIntroOk={() => update(dismissIntro)} onPredict={() => update(toPredict)} onUndo={() => update(s => undoTurn(s, true))} />;
      break;
    case 'predict':
      main = <PredictScreen session={session} onChoose={k => update(s => choose(s, k))} onBack={() => update(backToDecide)} onRun={() => update(runTurn)} />;
      break;
    case 'result':
      main = <ResultScreen key={core.turn} session={session} onNext={() => update(nextTurn)} onUndo={() => update(s => undoTurn(s, true))} />;
      break;
    case 'shortage':
      main = <ShortageScreen session={session} onRetry={() => update(retryTurn)} onRetryPrev={() => update(s => undoTurn(s, false))} onRestart={restart} />;
      break;
    case 'quiz':
      main = <QuizScreen session={session} reviewed={quizReviewed} onAnswer={i => update(s => answerQuiz(s, i))}
        onNext={() => { const n = session.quizAnswers.length; setQuizReviewed(n); if (n >= 5) update(finishQuiz); }} />;
      break;
    case 'finished':
      main = <FinishedScreen session={session} onReplay={() => { setSession(startSession(core.difficulty, core.seed)); setQuizReviewed(0); }} onTitle={toTitle} />;
      break;
  }

  return (
    <UiContext.Provider value={{ difficulty: core.difficulty, turn: vt, openTerm: id => setModal({ type: 'term', term: id }) }}>
      <div className="app">
        <GameHeader session={session} onGlossary={() => setModal({ type: 'glossary' })} onMenu={() => setModal({ type: 'menu' })} />
        {notices.length > 0 && <div className="card notice" role="status">{notices.map((n, i) => <p key={i}>{n}</p>)}<button type="button" className="btn small ghost" onClick={() => setNotices([])}>閉じる</button></div>}
        {saveFailed && <p className="small warn center">※このブラウザでは保存できない設定のため、ページを閉じると進み具合が消えます。</p>}
        <main className="main">{main}</main>
        <Modal modal={modal} onClose={closeModal} setModal={setModal} difficulty={core.difficulty} turn={vt} latest={latest}
          menu={{
            seed: core.seed,
            canUndo: d.undo && core.history.length > 0 && (session.phase === 'decide' || session.phase === 'result'),
            onUndo: () => { update(s => undoTurn(s, true)); setModal(null); },
            onTitle: toTitle, onRestart: restart
          }} />
      </div>
    </UiContext.Provider>
  );
}
