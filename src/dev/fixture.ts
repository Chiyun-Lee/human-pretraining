// Sample summaries for checking the reader's look without signing in or
// calling Claude. Used only in development, with ?file=samples/attention.pdf&demo
import type { Region } from '../summaries/regions'
import type { Slide } from '../summaries/slide'

export const demoRegions: Region[] = [
  { page: 1, x0: 133, y0: 235, x1: 204, y1: 256, kind: 'detail', caveat: null, bullets: ['Author and affiliation'] },
  { page: 3, x0: 210, y0: 404, x1: 402, y1: 415, kind: 'figure', caveat: null, bullets: ['Fig. 1: encoder (left) and decoder (right), each a stack of 6 identical layers.'] },
  { page: 3, x0: 108, y0: 503, x1: 506, y1: 579, kind: 'summary', caveat: null, bullets: ['Each encoder layer is self-attention then a feed-forward network, with residual connections and layer normalisation.'] },
  { page: 3, x0: 108, y0: 591, x1: 504, y1: 667, kind: 'detail', caveat: null, bullets: ['← Continued'] },
  { page: 2, x0: 108, y0: 99, x1: 504, y1: 246, kind: 'summary', caveat: null, bullets: ['RNNs, LSTMs and GRUs are the state of the art for sequence modelling and translation.', 'They compute one position at a time, so they cannot be parallelised within a training example.'] },
  { page: 2, x0: 108, y0: 251, x1: 506, y1: 344, kind: 'summary', caveat: 'Training cost is quoted for one hardware setup only.', bullets: ['Attention models dependencies regardless of distance, but is usually bolted onto an RNN.', 'The Transformer drops recurrence entirely: 12 hours on 8 P100 GPUs reaches a new best in translation.'] },
  { page: 2, x0: 108, y0: 389, x1: 505, y1: 487, kind: 'detail', caveat: null, bullets: ['Related convolutional models'] },
  { page: 2, x0: 108, y0: 493, x1: 506, y1: 623, kind: 'summary', caveat: null, bullets: ['Self-attention relates positions of one sequence to build its representation.', 'This is the first transduction model built on self-attention alone.'] },
]

export const demoSlide: Slide = {
  paper_title: 'Attention Is All You Need',
  title: 'Who needs recurrence anyway?',
  takeaway: 'A model built only from attention beats recurrent translators (28.4 BLEU on English-German) and trains in a fraction of the time.',
  flow: [
    { kind: 'question', text: 'Can sequence models drop recurrence and convolution?' },
    { kind: 'approach', text: 'Stack self-attention and feed-forward layers: the Transformer' },
    { kind: 'approach', text: 'Train on WMT 2014 for 3.5 days on 8 GPUs' },
    { kind: 'finding', text: '28.4 BLEU En-De, 41.8 En-Fr: new single-model bests' },
    { kind: 'meaning', text: 'Attention alone is enough, and it parallelises' },
  ],
  bullets: [
    'Multi-head attention lets the model attend to several positions at once.',
    'Sinusoidal position encodings stand in for the order that recurrence gave for free.',
    'It also transfers to English constituency parsing with little tuning.',
    'Tested only on text; long inputs may need restricted attention.',
  ],
}
