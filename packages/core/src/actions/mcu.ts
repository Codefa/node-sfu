import { MediaInfo } from "../domains/room/media/media";
import { Room } from "../domains/room/room";

export const listenMixedAudio = (room: Room) => async (
  subscriberId: string,
  infos: MediaInfo[]
) => {
  const peer = room.peers[subscriberId];
  const transceiver = peer.addTransceiver("audio", "sendonly");
  await peer.setLocalDescription(peer.createOffer());

  const mcu = room.createMCU(infos, transceiver);
  const meta = { mid: transceiver.mid, mixId: mcu.id };

  return { peer, meta };
};

export const addMixedAudioTrack = (room: Room) => async (
  mixerId: string,
  info: MediaInfo
) => {
  const media = room.medias[info.mediaId];
  const mcu = room.getMCU(mixerId);
  mcu.inputMedia(media);
};

export const removeMixedAudioTrack = (room: Room) => async (
  mixerId: string,
  info: MediaInfo
) => {
  const media = room.medias[info.mediaId];
  const mcu = room.getMCU(mixerId);
  mcu.removeMedia(media.mediaId);
};
