import { RTCRtpTransceiver, RtpTrack } from "../werift";
import { Subscriber, SubscriberType } from "./subscriber";
import { Track } from "./track";

export class Media {
  tracks: Track[] = [];

  subscribers: {
    [subscriberId: string]: Subscriber;
  } = {};

  constructor(
    public mediaId: string,
    public publisherId: string,
    public kind: string
  ) {}

  addTrack(rtpTrack: RtpTrack, receiver: RTCRtpTransceiver) {
    if (this.kind !== rtpTrack.kind) throw new Error();

    const track = new Track(rtpTrack, receiver);

    this.tracks.push(track);
  }

  stop() {
    this.tracks.forEach(({ stop }) => stop());
    Object.values(this.subscribers).forEach(({ stop }) => stop());

    return this.subscribers;
  }

  subscribe(
    subscriberId: string,
    sender: RTCRtpTransceiver,
    type: SubscriberType
  ) {
    const subscriber = (this.subscribers[subscriberId] = new Subscriber(
      sender,
      this.tracks
    ));
    switch (type) {
      case "fixed":
        subscriber.fixed();
        break;
      case "high":
        subscriber.high();
        subscriber.watchREMB();
        break;
      case "low":
        subscriber.low();
        subscriber.watchREMB();
        break;
    }
  }

  changeQuality(subscriberId: string, type: SubscriberType) {
    const subscriber = this.subscribers[subscriberId];
    subscriber.state = type;
  }

  has(subscriberId: string) {
    return !!this.subscribers[subscriberId];
  }

  unsubscribe(subscriberId: string) {
    const subscriber = this.subscribers[subscriberId];
    subscriber.stop();
    delete this.subscribers[subscriberId];
  }
}
