// Video consult: WebRTC between patient and doctor. The server only relays
// connection details and translates captions; audio and video go directly
// between the two devices. Tuned for weak networks: 360p/15fps capped at
// ~300 kbps, and one tap switches to audio only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import { getSocket } from '../lib/socket';
import { LANGUAGES } from '../i18n';

const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const MAX_VIDEO_BITRATE = 300_000;

export default function Consult() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useSelector((s) => s.session.user);

  const [status, setStatus] = useState('joining'); // joining | waiting | connecting | connected | reconnecting | error
  const [error, setError] = useState(null);
  const [peerName, setPeerName] = useState('');
  const [videoOn, setVideoOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [remoteVideo, setRemoteVideo] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(Boolean(SpeechRecognition));
  const [captions, setCaptions] = useState([]);

  const localVideo = useRef(null);
  const remoteVideoEl = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const roleRef = useRef(null);
  const iceRef = useRef([]);
  const pendingIce = useRef([]);
  const socketRef = useRef(null);

  const signal = useCallback((data) => socketRef.current?.emit('consult:signal', { appointmentId: id, data }), [id]);

  const createPc = useCallback(() => {
    pcRef.current?.close();
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    pcRef.current = pc;
    pendingIce.current = [];
    streamRef.current?.getTracks().forEach((track) => pc.addTrack(track, streamRef.current));
    pc.ontrack = (e) => {
      if (remoteVideoEl.current) remoteVideoEl.current.srcObject = e.streams[0];
    };
    pc.onicecandidate = (e) => e.candidate && signal({ candidate: e.candidate });
    pc.onconnectionstatechange = async () => {
      if (pc.connectionState === 'connected') {
        setStatus('connected');
        // Cap video bitrate so the call survives 3G.
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind !== 'video') continue;
          const params = sender.getParameters();
          params.encodings = (params.encodings?.length ? params.encodings : [{}]).map((enc) => ({ ...enc, maxBitrate: MAX_VIDEO_BITRATE }));
          await sender.setParameters(params).catch(() => {});
        }
      } else if (pc.connectionState === 'disconnected') setStatus('reconnecting');
      else if (pc.connectionState === 'failed' && roleRef.current === 'doctor') {
        setStatus('reconnecting');
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        signal({ description: pc.localDescription });
      }
    };
    return pc;
  }, [signal]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    if (!socket) return undefined;
    let stopped = false;

    const onReady = async () => {
      setStatus('connecting');
      const pc = createPc();
      // The doctor starts the call; the patient answers.
      if (roleRef.current === 'doctor') {
        await pc.setLocalDescription(await pc.createOffer());
        signal({ description: pc.localDescription });
      }
    };
    const onSignal = async ({ data }) => {
      let pc = pcRef.current;
      if (data.description) {
        if (!pc) pc = createPc();
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          signal({ description: pc.localDescription });
        }
        for (const c of pendingIce.current.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else pendingIce.current.push(data.candidate);
      }
    };
    const onPeerLeft = () => {
      pcRef.current?.close();
      pcRef.current = null;
      if (remoteVideoEl.current) remoteVideoEl.current.srcObject = null;
      setStatus('waiting');
    };
    const onMedia = ({ video }) => setRemoteVideo(video);
    const onCaption = (c) =>
      setCaptions((list) => {
        const rest = list.filter((x) => x.id !== c.id);
        return [...rest, { ...c, mine: c.from === roleRef.current }].slice(-4);
      });

    socket.on('consult:ready', onReady);
    socket.on('consult:signal', onSignal);
    socket.on('consult:peer-left', onPeerLeft);
    socket.on('consult:media', onMedia);
    socket.on('consult:caption', onCaption);

    (async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { max: 15 } },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setVideoOn(false);
        } catch {
          setError(t('Allow camera and microphone to join the call.'));
          setStatus('error');
          return;
        }
      }
      if (stopped) return stream.getTracks().forEach((tr) => tr.stop());
      streamRef.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;

      socket.emit('consult:join', { appointmentId: id }, (res) => {
        if (res?.error) {
          setError(res.error);
          setStatus('error');
          return;
        }
        roleRef.current = res.role;
        iceRef.current = res.iceServers;
        setPeerName(res.peer);
        setStatus(res.peerPresent ? 'connecting' : 'waiting');
      });
    })();

    return () => {
      stopped = true;
      socket.emit('consult:leave', { appointmentId: id });
      socket.off('consult:ready', onReady);
      socket.off('consult:signal', onSignal);
      socket.off('consult:peer-left', onPeerLeft);
      socket.off('consult:media', onMedia);
      socket.off('consult:caption', onCaption);
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, [id, createPc, signal, t]);

  // Speech-to-text for my own voice; the server translates it for the other side.
  useEffect(() => {
    if (!SpeechRecognition || !captionsOn || !micOn || status !== 'connected') return undefined;
    const rec = new SpeechRecognition();
    rec.lang = LANGUAGES.find((l) => l.code === i18n.language)?.speech ?? 'en-IN';
    rec.continuous = true;
    rec.interimResults = false;
    let active = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) socketRef.current?.emit('consult:caption', { appointmentId: id, text: e.results[i][0].transcript });
      }
    };
    rec.onend = () => active && rec.start();
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        active = false;
        setCaptionsOn(false);
      }
    };
    rec.start();
    return () => {
      active = false;
      rec.abort();
    };
  }, [captionsOn, micOn, status, id, i18n.language]);

  function toggleVideo() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setVideoOn(track.enabled);
    socketRef.current?.emit('consult:media', { appointmentId: id, video: track.enabled });
  }
  function toggleMic() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }
  function hangUp() {
    navigate(user?.role === 'doctor' ? '/doctor' : `/appointments/${id}`, { replace: true });
  }

  const statusText = {
    joining: t('Joining…'),
    waiting: t('Waiting for {{name}} to join…', { name: peerName || t('the other person') }),
    connecting: t('Connecting…'),
    connected: t('Connected · encrypted'),
    reconnecting: t('Weak network — reconnecting…'),
    error: error,
  }[status];

  const ctrl = 'grid size-14 place-items-center rounded-full';

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b131d] text-white">
      <div className="relative flex-1 overflow-hidden">
        <video ref={remoteVideoEl} autoPlay playsInline className={`size-full object-cover ${status === 'connected' && remoteVideo ? '' : 'invisible'}`} />
        {(status !== 'connected' || !remoteVideo) && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-4 px-6 text-center">
              <span className="font-display grid size-32 place-items-center rounded-full bg-white/10 text-5xl font-bold">
                {(peerName || '?')
                  .replace('Dr. ', '')
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)}
              </span>
              {status === 'connected' && !remoteVideo && <p className="text-white/80">{t('Camera is off · audio only')}</p>}
            </div>
          </div>
        )}

        <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
          <div className="rounded-2xl bg-black/55 px-4 py-2.5 backdrop-blur">
            <p className="font-bold">{peerName || t('Video consult')}</p>
            <p className={`text-sm ${status === 'error' ? 'text-red-300' : status === 'connected' ? 'text-emerald-300' : 'text-white/80'}`} role="status">
              {statusText}
            </p>
          </div>
          <video
            ref={localVideo}
            autoPlay
            playsInline
            muted
            className={`h-36 w-24 rounded-2xl border-2 border-white object-cover md:h-44 md:w-32 ${videoOn ? '' : 'opacity-0'}`}
          />
        </div>

        {captions.length > 0 && (
          <div className="absolute inset-x-4 bottom-4 mx-auto flex max-w-2xl flex-col gap-2 rounded-2xl bg-black/70 p-4 backdrop-blur" aria-live="polite">
            {captions.map((c) =>
              c.mine ? (
                <p key={c.id} className="text-sm text-white/70">
                  {t('You')}: {c.text}
                </p>
              ) : (
                <div key={c.id}>
                  <p lang={c.translatedLang || c.lang} className="text-lg leading-snug font-semibold">
                    {c.translated || c.text}
                  </p>
                  {c.translated && <p className="text-sm text-white/60">{c.text}</p>}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 bg-[#0b131d] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={toggleMic}
          aria-pressed={!micOn}
          aria-label={micOn ? t('Mute') : t('Unmute')}
          className={`${ctrl} ${micOn ? 'bg-white/15' : 'bg-white text-ink'}`}
        >
          <Icon name="mic" />
        </button>
        <button
          type="button"
          onClick={toggleVideo}
          aria-pressed={!videoOn}
          aria-label={videoOn ? t('Turn camera off (audio only)') : t('Turn camera on')}
          className={`${ctrl} ${videoOn ? 'bg-white/15' : 'bg-white text-ink'}`}
        >
          <Icon name="video" />
        </button>
        <button type="button" onClick={hangUp} aria-label={t('End call')} className="grid h-14 w-20 place-items-center rounded-full bg-sos hover:bg-sos-dark">
          <Icon name="phone" className="rotate-[135deg]" />
        </button>
        {SpeechRecognition && (
          <button
            type="button"
            onClick={() => setCaptionsOn((v) => !v)}
            aria-pressed={captionsOn}
            aria-label={t('Live translated captions')}
            className={`${ctrl} text-sm font-extrabold ${captionsOn ? 'bg-white text-ink' : 'bg-white/15'}`}
          >
            CC
          </button>
        )}
      </div>
    </div>
  );
}
