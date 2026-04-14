// Gemini calls are proxied through /api/gemini.php so the API key stays on
// the server. The SDK is no longer used on the client.

import { bufferToWave } from './audioUtils';
import { FillerMarker } from '../types';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PROXY_URL = '/api/gemini.php';

interface ProxyPayload {
  contents: any;
  generationConfig?: any;
}

const callProxy = async (model: string, payload: ProxyPayload): Promise<any> => {
  const resp = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, payload }),
  });
  if (!resp.ok) {
    let msg = `Proxy error ${resp.status}`;
    try {
      const j = await resp.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return resp.json();
};

const extractText = (response: any): string => {
  try {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts) return '';
    return parts.map((p: any) => p.text || '').join('');
  } catch {
    return '';
  }
};

export const analyzePodcastContent = async (
  bufferA: AudioBuffer,
  bufferB: AudioBuffer,
  bufferC?: AudioBuffer,
): Promise<string> => {
  try {
    const sampleRate = 16000;
    const durationToAnalyze = 45;
    const startOffset = Math.min(bufferA.duration / 2, 10);
    const lengthSamples = durationToAnalyze * sampleRate;

    const offlineCtx = new OfflineAudioContext(1, lengthSamples, sampleRate);
    const connectSource = (buf: AudioBuffer) => {
      const src = offlineCtx.createBufferSource();
      src.buffer = buf;
      src.connect(offlineCtx.destination);
      src.start(0, startOffset);
    };
    connectSource(bufferA);
    connectSource(bufferB);
    if (bufferC) connectSource(bufferC);

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWave(renderedBuffer, renderedBuffer.length);

    const base64Audio = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.readAsDataURL(wavBlob);
    });

    const response = await callProxy('gemini-2.5-flash', {
      contents: [
        {
          parts: [
            { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
            {
              text: 'Analyze this podcast segment. 1) Identify the tone (e.g. heated, friendly, interview). 2) Summarize the topic discussed in 2 sentences. 3) Suggest a catchy title for this episode.',
            },
          ],
        },
      ],
    });

    return extractText(response) || 'No analysis could be generated.';
  } catch (error) {
    console.error('Gemini Analysis Error:', error);
    return 'Error generating AI analysis. Please try again.';
  }
};

export const detectFillerWords = async (
  buffer: AudioBuffer,
  onProgress?: (percent: number) => void,
): Promise<FillerMarker[]> => {
  try {
    const CHUNK_DURATION = 30;
    const SAMPLE_RATE = 16000;
    const CONCURRENCY = 2;

    const totalDuration = buffer.duration;
    const allMarkers: FillerMarker[] = [];

    const tasks: { start: number; end: number; retries: number }[] = [];
    for (let t = 0; t < totalDuration; t += CHUNK_DURATION) {
      tasks.push({
        start: t,
        end: Math.min(t + CHUNK_DURATION, totalDuration),
        retries: 0,
      });
    }

    let completedTasks = 0;

    const processChunk = async (task: {
      start: number;
      end: number;
      retries: number;
    }): Promise<FillerMarker[]> => {
      const chunkLength = task.end - task.start;
      if (chunkLength < 0.5) return [];
      const lengthSamples = Math.floor(chunkLength * SAMPLE_RATE);

      const offlineCtx = new OfflineAudioContext(1, lengthSamples, SAMPLE_RATE);
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(offlineCtx.destination);
      source.start(0, task.start, chunkLength);

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = bufferToWave(renderedBuffer, renderedBuffer.length);

      const base64Audio = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () =>
          resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(wavBlob);
      });

      try {
        const response = await callProxy('gemini-2.5-flash', {
          contents: [
            {
              parts: [
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                {
                  text: `List all NON-LEXICAL filler sounds (um, uh, ah, er, emmm, ehhh, mmm). Include Hebrew fillers. Strictly ignore real words like "like", "you know", "right", "okay". Respond as strict JSON array [{word,start,end}] where start/end are seconds.`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
            temperature: 0.3,
          },
        });

        const text = extractText(response);
        if (text) {
          const rawData = JSON.parse(text) as {
            word: string;
            start: number;
            end: number;
          }[];
          if (Array.isArray(rawData)) {
            return rawData.map((item) => ({
              word: item.word,
              start: item.start + task.start,
              end: item.end + task.start,
            }));
          }
        }
      } catch (e: any) {
        if (
          e.message &&
          (e.message.includes('429') || e.message.includes('rate')) &&
          task.retries < 2
        ) {
          await delay(10000);
          task.retries++;
          return processChunk(task);
        }
        console.error(`Error in chunk starting at ${task.start}s`, e);
      }
      return [];
    };

    const queue = [...tasks];
    const worker = async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) break;
        const markers = await processChunk(task);
        allMarkers.push(...markers);
        completedTasks++;
        if (onProgress) onProgress((completedTasks / tasks.length) * 100);
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);

    allMarkers.sort((a, b) => a.start - b.start);
    return allMarkers;
  } catch (e) {
    console.error('detectFillerWords failed', e);
    return [];
  }
};
