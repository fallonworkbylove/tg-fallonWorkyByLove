/* local smoke: «теперь ты» + interview reply → rewrite */
const AI_INTERVIEW_RE =
  /(?:какие\s+впечатления|машины\s+всегда\s+были\s+увлечением|это\s+ну\s+ок|ну\s+ок,?\s+какие|расскажи\s+подробнее|интересно\s+узнать\s+больше)/i;
const YOUR_TURN_RE =
  /(?:теперь\s+ты|твоя\s+очередь|теперь\s+о\s+себе|а\s+теперь\s+ты|расскажи\s+(?:о\s+себе|про\s+себя)|tell\s+me\s+about\s+yourself)/i;

const reply =
  'ок, Андрей) ауди - это ну ок, какие впечатления от неё? машины всегда были увлечением?';
const msg = 'Теперь ты';

if (!YOUR_TURN_RE.test(msg)) throw new Error('your_turn miss');
if (!AI_INTERVIEW_RE.test(reply)) throw new Error('interview miss');
console.log('ok would_rewrite');
