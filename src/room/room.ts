/* eslint-disable @typescript-eslint/ban-ts-comment */
import { v4 } from "uuid";
import {
  HandleAnswerDone,
  HandleOffer,
  HandleMedias,
  RPC,
  HandlePublish,
  HandleLeave,
} from "../typings/rpc";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  Kind,
  RTCIceCandidateJSON,
  useSdesRTPStreamID,
  RTCRtpTransceiver,
} from "../werift";
import {
  useAbsSendTime,
  useSdesMid,
} from "../werift/rtc/extension/rtpExtension";
import { Router, MediaInfo } from "./router";
import { SubscriberType } from "./subscriber";

export class Room {
  router = new Router();
  peers: { [peerId: string]: RTCPeerConnection } = {};

  async join(): Promise<[string, RTCSessionDescription]> {
    const peerId = v4();
    const peer = (this.peers[peerId] = new RTCPeerConnection({
      stunServer: ["stun.l.google.com", 19302],
      headerExtensions: {
        video: [useSdesMid(1), useAbsSendTime(2), useSdesRTPStreamID(3)],
      },
    }));

    peer.createDataChannel("sfu").message.subscribe((msg) => {
      const { type, payload } = JSON.parse(msg as string) as RPC;
      //@ts-ignore
      this[type](...payload);
    });

    peer.iceConnectionStateChange.subscribe((state) => {
      console.log(peerId, state);
      if (state === "closed") {
        this.leave(peerId);
      }
    });

    await peer.setLocalDescription(peer.createOffer());
    return [peerId, peer.localDescription];
  }

  // --------------------------------------------------------------------
  // RPC

  async handleAnswer(peerId: string, answer: RTCSessionDescription) {
    console.log("handleAnswer", peerId);
    const peer = this.peers[peerId];

    await peer.setRemoteDescription(answer);
    this.sendRPC<HandleAnswerDone>(
      { type: "handleAnswerDone", payload: [] },
      peer
    );
  }

  async handleCandidate(peerId: string, candidate: RTCIceCandidateJSON) {
    console.log("handleCandidate", peerId);
    const peer = this.peers[peerId];
    await peer.addIceCandidate(candidate);
  }

  private publish = async (
    publisherId: string,
    request: { kind: Kind; simulcast: boolean }[]
  ) => {
    console.log("publish", publisherId, request);
    const peer = this.peers[publisherId];

    request
      .map(({ kind, simulcast }): [RTCRtpTransceiver, string, boolean] => {
        if (!simulcast) {
          return [peer.addTransceiver(kind, "recvonly"), kind, simulcast];
        } else {
          return [
            peer.addTransceiver("video", "recvonly", {
              simulcast: [
                { rid: "high", direction: "recv" },
                { rid: "low", direction: "recv" },
              ],
            }),
            kind,
            simulcast,
          ];
        }
      })
      .forEach(async ([transceiver, kind, simulcast]) => {
        const mediaId = v4();
        const mediaInfo = this.router.addMedia(publisherId, mediaId, kind);

        if (simulcast) {
          await transceiver.onTrack.asPromise();
          transceiver.receiver.tracks.forEach((track) =>
            this.router.addTrack(publisherId, track, transceiver, mediaId)
          );
        } else {
          const track = await transceiver.onTrack.asPromise();
          this.router.addTrack(publisherId, track, transceiver, mediaId);
        }

        Object.values(this.peers)
          .filter((others) => others.cname !== peer.cname)
          .forEach((peer) => {
            this.sendRPC<HandlePublish>(
              {
                type: "handlePublish",
                payload: [mediaInfo],
              },
              peer
            );
          });
      });

    await this.sendOffer(peer);
  };

  private getMedias = (peerId: string) => {
    console.log("getMedias", peerId);
    const peer = this.peers[peerId];
    this.sendRPC<HandleMedias>(
      {
        type: "handleMedias",
        payload: [this.router.mediaInfos],
      },
      peer
    );
  };

  private subscribe = async (
    subscriberId: string,
    requests: { info: MediaInfo; type: SubscriberType }[]
  ) => {
    const peer = this.peers[subscriberId];

    requests.forEach(({ info, type }) => {
      const { publisherId, mediaId, kind } = info;
      const transceiver = peer.addTransceiver(kind as Kind, "sendonly");
      this.router.subscribe(
        subscriberId,
        publisherId,
        mediaId,
        transceiver,
        type
      );
    });

    await this.sendOffer(peer);
  };

  private leave = async (peerId: string) => {
    this.router.getSubscribed(peerId).forEach((media) => {
      this.router.unsubscribe(peerId, media.publisherId, media.mediaId);
    });

    const infos = this.router.mediaInfos.filter(
      (info) => info.publisherId === peerId
    );
    const subscribers = infos.map((info) =>
      this.router.removeMedia(peerId, info.mediaId)
    );

    const targets: { [subscriberId: string]: RTCPeerConnection } = {};

    subscribers.forEach((subscriber) => {
      Object.entries(subscriber).forEach(([subscriberId, pair]) => {
        const peer = this.peers[subscriberId];
        if (!peer) return;
        peer.removeTrack(pair.sender.sender);
        targets[subscriberId] = peer;
      });
    });

    delete this.peers[peerId];

    await Promise.all(
      Object.values(targets).map(async (peer) => {
        await peer.setLocalDescription(peer.createOffer());
        this.sendRPC<HandleLeave>(
          { type: "handleLeave", payload: [infos, peer.localDescription] },
          peer
        );
      })
    );
  };

  // --------------------------------------------------------------------
  // util
  private async sendOffer(peer: RTCPeerConnection) {
    await peer.setLocalDescription(peer.createOffer());

    this.sendRPC<HandleOffer>(
      {
        type: "handleOffer",
        payload: [peer.localDescription],
      },
      peer
    );
  }

  private sendRPC<T extends RPC>(msg: T, peer: RTCPeerConnection) {
    const channel = peer.sctpTransport.channelByLabel("sfu");
    if (!channel) return;
    channel.send(JSON.stringify(msg));
  }
}
