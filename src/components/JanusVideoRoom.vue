<template>
	<div class="grid-container">
		<div class="grid-item">
		</div>
		<div class="grid-item" ref="publicher">
			<div class="participant-info">Participant 1</div>
			<video autoplay></video>
		</div>
	</div>
	<div class="grid-container">
		<div class="grid-item" v-for="publisher in publishers" :key="publisher.id" :ref="`remotePublicher-${publisher.id}`">
			<div class="participant-info">Participant</div>
			<video autoplay></video>
		</div>
	</div>
</template>
  
<script>
import Janus from 'janus-gateway';


export default {
	data() {
		return {
			server: 'https://vc.cinteraction.com:8088/janus',
			iceServers: null,
			janus: null,
			sfutest: null,
			room: 1234,
			myusername: "ILIJAKAMENKO",
			myid: null,
			mystream: null,
			mypvtid: null,
			remoteFeed: null,
			feeds: {},
			feedStreams: {},
			subStreams: {},
			slots: {},
			mids: {},
			subscriptions: {},
			publishers: [],
			localTracks: {},
			localVideos: 0,
			remoteTracks: {},
			bitrateTimer: [],
			simulcastStarted: {},
			svcStarted: {},
			doSimulcast: false,
			doSvc: null,
			acodec: null,
			vcodec: null,
			subscriber_mode: false,
			use_msid: false,
			creatingSubscription: false
		};
	},
	mounted() {
		Janus.init({
			debug: "all",
			callback: () => {
				this.initJanus();
			},
		});
	},
	methods: {
		initJanus() {
			if (!Janus.isWebrtcSupported()) {
				alert("No WebRTC support... ");
				return;
			}
			const janus = new Janus({
				server: this.server,
				iceServers: this.iceServers,
				success: () => {
					this.attachToVideoRoom();
				},
				error: (error) => {
					console.error('Error creating Janus instance:', error);
				},
			});
			this.janus = janus;
		},
		attachToVideoRoom() {
			this.janus.attach({
				plugin: 'janus.plugin.videoroom',
				success: (pluginHandle) => {
					this.sfutest = pluginHandle;
					Janus.log("Plugin attached! (" + this.sfutest.getPlugin() + ", id=" + this.sfutest.getId() + ")");
					Janus.log("  -- This is a publisher/manager");

					const register = { request: 'join', room: this.room, ptype: 'publisher', display: this.myusername };
					this.sfutest.send({ message: register });
				},
				error: (error) => {
					Janus.error("  -- Error attaching plugin...", error);
				},
				onmessage: (msg, jsep) => {
					Janus.debug(" ::: Got a message (publisher) :::", msg);
					const event = msg['videoroom'];
					Janus.debug("Event: " + event);
					if (event != undefined && event != null) {
						if (event === "joined") {
							// Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
							this.myid = msg["id"];
							this.mypvtid = msg["private_id"];
							Janus.log("Successfully joined room " + msg["room"] + " with ID " + this.myid);

							if (!this.subscriber_mode) {
								this.publishOwnFeed(true);
								//this.startLocalStream(); 
							}

							if (msg["publishers"]) {
								this.publishers = msg['publishers'];
								if (this.publishers) {
									let list = this.publishers;
									Janus.debug("Got a list of available publishers/feeds:", list);
									let sources = null;
									for (let f in list) {
										if (list[f]["dummy"])
											continue;
										let id = list[f]["id"];
										let display = list[f]["display"];
										let streams = list[f]["streams"];
										for (let i in streams) {
											let stream = streams[i];
											stream["id"] = id;
											stream["display"] = display;
										}
										let slot = this.feedStreams[id] ? this.feedStreams[id].slot : null;
										let remoteVideos = this.feedStreams[id] ? this.feedStreams[id].remoteVideos : 0;
										this.feedStreams[id] = {
											id: id,
											display: display,
											streams: streams,
											slot: slot,
											remoteVideos: remoteVideos
										}
										Janus.debug("  >> [" + id + "] " + display + ":", streams);
										if (!sources)
											sources = [];
										sources.push(streams);
									}
									if (sources)
										this.subscribeTo(sources);
								}

							}
						} else if (event === "destroyed") {
							Janus.warn("The room has been destroyed!");
						} else if (event === "event") {
							// Any info on our streams or a new feed to attach to?
							if (msg["streams"]) {
								let streams = msg["streams"];
								for (let i in streams) {
									let stream = streams[i];
									stream["id"] = this.myid;
									stream["display"] = this.myusername;
								}
								this.feedStreams[this.myid] = {
									id: this.myid,
									display: this.myusername,
									streams: streams
								}
							} else if (msg["publishers"]) {

								let list = msg["publishers"];
								Janus.debug("Got a list of available publishers/feeds:", list);
								let sources = null;
								for (let f in list) {
									if (list[f]["dummy"])
										continue;
									this.publishers.push(f);
									let id = list[f]["id"];
									let display = list[f]["display"];
									let streams = list[f]["streams"];
									for (let i in streams) {
										let stream = streams[i];
										stream["id"] = id;
										stream["display"] = display;
									}
									let slot = this.feedStreams[id] ? this.feedStreams[id].slot : null;
									let remoteVideos = this.feedStreams[id] ? this.feedStreams[id].remoteVideos : 0;
									this.feedStreams[id] = {
										id: id,
										display: display,
										streams: streams,
										slot: slot,
										remoteVideos: remoteVideos
									}
									Janus.debug("  >> [" + id + "] " + display + ":", streams);
									if (!sources)
										sources = [];
									sources.push(streams);
								}
								if (sources)
									this.subscribeTo(sources);
							} else if (msg["leaving"]) {
								// One of the publishers has gone away?
								let leaving = msg["leaving"];
								Janus.log("Publisher left: " + leaving);
								this.unsubscribeFrom(leaving);
							} else if (msg["unpublished"]) {
								// One of the publishers has unpublished?
								let unpublished = msg["unpublished"];
								Janus.log("Publisher left: " + unpublished);
								if (unpublished === 'ok') {
									// That's us
									this.sfutest.hangup();
									return;
								}
								this.unsubscribeFrom(unpublished);
							} else if (msg["error"]) {
								Janus.error("Publisher left: " + msg["error"]);
							}
						}
					}
					if (jsep) {
						Janus.debug("Handling SDP as well...", jsep);
						this.sfutest.handleRemoteJsep({ jsep: jsep });
						// Check if any of the media we wanted to publish has
						// been rejected (e.g., wrong or unsupported codec)
						let audio = msg["audio_codec"];
						if (this.mystream && this.mystream.getAudioTracks() && this.mystream.getAudioTracks().length > 0 && !audio) {
							// Audio has been rejected
							Janus.warning("Our audio stream has been rejected, viewers won't hear us");
						}
						let video = msg["video_codec"];
						if (this.mystream && this.mystream.getVideoTracks() && this.mystream.getVideoTracks().length > 0 && !video) {
							// Video has been rejected
							Janus.warning("Our video stream has been rejected, viewers won't see us");
						}
					}
				},
				onlocaltrack: (track, on) => {
					Janus.debug(" ::: Got a local track event :::");
					Janus.debug("Local track " + (on ? "added" : "removed") + ":", track);
					// We use the track ID as name of the element, but it may contain invalid characters
					let trackId = track.id.replace(/[{}]/g, "");
					if (!on) {
						// Track removed, get rid of the stream and the rendering
						let stream = null;
						if (this.localTracks.length > 0)
							stream = this.localTracks[trackId];
						if (stream) {
							try {
								let tracks = stream.getTracks();
								for (let i in tracks) {
									let mst = tracks[i];
									if (mst)
										mst.stop();
								}
							} catch (e) {
								Janus.error(e);
							}
						}
						if (track.kind === "video") {
							this.localVideos--;
							if (this.localVideos === 0) {
								// No video, at least for now: show a placeholder
								
							}
						}
						delete this.localTracks[trackId];
						return;
					}
					// If we're here, a new track was added
					let stream = null;
					if (this.localTracks != null && this.localTracks.length > 0)
						stream = this.localTracks[trackId];
					if (stream) {
						// We've been here already
						return;
					}
					
					if (track.kind === "audio") {
						// We ignore local audio tracks, they'd generate echo anyway
						if (this.localVideos === 0) {
							// No video, at least for now: show a placeholder
							
						}
					} else {
						// New video track: create a stream out of it
						this.localVideos++;
						//$('#videolocal .no-video-container').remove();
						let stream = new MediaStream([track]);

						if (this.localTracks != null && this.localTracks.length > 0)
							this.localTracks[trackId] = stream;


						Janus.log("Created local stream:", stream);
						Janus.log(stream.getTracks());
						Janus.log(stream.getVideoTracks());
						const videoElement = this.$refs.publicher.querySelector('video');
						videoElement.srcObject = stream;
						const name = this.$refs.publicher.querySelector('div');
						name.textContent = this.myusername;


					}
				},
				// eslint-disable-next-line no-unused-vars
				onremotetrack: (track, mid, on) => {
					// The publisher stream is sendonly, we don't expect anything here
				},
				oncleanup: () => {
					Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
					this.mystream = null;
					delete this.feedStreams[this.myid];
					// $('#videolocal').html('<button id="publish" class="btn btn-primary">Publish</button>');
					// $('#publish').click(function () { publishOwnFeed(true); });
					// $("#videolocal").parent().parent().unblock();
					// $('#bitrate').parent().parent().addClass('hide');
					// $('#bitrate a').unbind('click');
					this.localTracks = {};
					this.localVideos = 0;
				}

			});
		},
		unpublishOwnFeed() {
			// Unpublish our stream
			let unpublish = { request: "unpublish" };
			this.sfutest.send({ message: unpublish });
		},
		toggleMute() {
			let muted = this.sfutest.isAudioMuted();
			Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
			if (muted)
				this.sfutest.unmuteAudio();
			else
				this.sfutest.muteAudio();
			muted = this.sfutest.isAudioMuted();
		},
		removeRemoteFeed(feedId) {
			const index = this.remoteFeeds.findIndex((feed) => feed.rfid === feedId);
			if (index !== -1) {
				this.remoteFeeds.splice(index, 1);
				this.displayRemoteVideos();
			}
		},
		subscribeTo(sources) {
			// Check if we're still creating the subscription handle
			if (this.creatingSubscription) {
				// Still working on the handle, send this request later when it's ready
				// setTimeout(function () {
				// 	this.subscribeTo(sources);
				// }, 500);
				return;
			}
			// If we already have a working subscription handle, just update that one
			if (this.remoteFeed) {
				// Prepare the streams to subscribe to, as an array: we have the list of
				// streams the feeds are publishing, so we can choose what to pick or skip
				let added = null, removed = null;
				for (let s in sources) {
					let streams = sources[s];
					for (let i in streams) {
						let stream = streams[i];
						// If the publisher is VP8/VP9 and this is an older Safari, let's avoid video
						if (stream.type === "video" && Janus.webRTCAdapter.browserDetails.browser === "safari" &&
							(stream.codec === "vp9" || (stream.codec === "vp8" && !Janus.safariVp8))) {
							continue;
						}
						if (stream.disabled) {
							Janus.log("Disabled stream:", stream);
							// Unsubscribe
							if (!removed)
								removed = [];
							removed.push({
								feed: stream.id,	// This is mandatory
								mid: stream.mid		// This is optional (all streams, if missing)
							});
							delete this.subscriptions[stream.id][stream.mid];
							continue;
						}
						if (this.subscriptions[stream.id] && this.subscriptions[stream.id][stream.mid]) {
							Janus.log("Already subscribed to stream, skipping:", stream);
							continue;
						}
						// Find an empty slot in the UI for each new source
						if (!this.feedStreams[stream.id].slot) {
							let slot;
							for (let i = 1; i < 6; i++) {
								if (!this.feeds[i]) {
									slot = i;
									this.feeds[slot] = stream.id;
									this.feedStreams[stream.id].slot = slot;
									this.feedStreams[stream.id].remoteVideos = 0;
									//$('#remote' + slot).removeClass('hide').html(escapeXmlTags(stream.display)).show();
									break;
								}
							}
						}
						// Subscribe
						if (!added)
							added = [];
						added.push({
							feed: stream.id,	// This is mandatory
							mid: stream.mid		// This is optional (all streams, if missing)
						});
						if (!this.subscriptions[stream.id])
							this.subscriptions[stream.id] = {};
						this.subscriptions[stream.id][stream.mid] = true;
					}
				}
				if ((!added || added.length === 0) && (!removed || removed.length === 0)) {
					// Nothing to do
					return;
				}
				let update = { request: 'update' };
				if (added)
					update.subscribe = added;
				if (removed)
					update.unsubscribe = removed;
				this.remoteFeed.send({ message: update });
				// Nothing else we need to do
				return;
			}
			// If we got here, we're creating a new handle for the subscriptions (we only need one)
			this.creatingSubscription = true;
			this.janus.attach(
				{
					plugin: "janus.plugin.videoroom",
					success: (pluginHandle) => {
						this.remoteFeed = pluginHandle;
						this.remoteTracks = {};
						Janus.log("Plugin attached! (" + this.remoteFeed.getPlugin() + ", id=" + this.remoteFeed.getId() + ")");
						Janus.log("  -- This is a multistream subscriber");
						// Prepare the streams to subscribe to, as an array: we have the list of
						// streams the feed is publishing, so we can choose what to pick or skip
						let subscription = [];
						for (let s in sources) {
							let streams = sources[s];
							for (let i in streams) {
								let stream = streams[i];
								// If the publisher is VP8/VP9 and this is an older Safari, let's avoid video
								if (stream.type === "video" && Janus.webRTCAdapter.browserDetails.browser === "safari" &&
									(stream.codec === "vp9" || (stream.codec === "vp8" && !Janus.safariVp8))) {
									continue;
								}
								if (stream.disabled) {
									Janus.log("Disabled stream:", stream);
									// TODO Skipping for now, we should unsubscribe
									continue;
								}
								Janus.log("Subscribed to " + stream.id + "/" + stream.mid + "?", this.subscriptions);
								if (this.subscriptions[stream.id] && this.subscriptions[stream.id][stream.mid]) {
									Janus.log("Already subscribed to stream, skipping:", stream);
									continue;
								}
								// Find an empty slot in the UI for each new source
								if (!this.feedStreams[stream.id].slot) {
									let slot;
									for (let i = 1; i < 6; i++) {
										if (!this.feeds[i]) {
											slot = i;
											this.feeds[slot] = stream.id;
											this.feedStreams[stream.id].slot = slot;
											this.feedStreams[stream.id].remoteVideos = 0;
											break;
										}
									}
								}
								subscription.push({
									feed: stream.id,	// This is mandatory
									mid: stream.mid		// This is optional (all streams, if missing)
								});
								if (!this.subscriptions[stream.id])
									this.subscriptions[stream.id] = {};
								this.subscriptions[stream.id][stream.mid] = true;
							}
						}
						// We wait for the plugin to send us an offer
						let subscribe = {
							request: "join",
							room: this.room,
							ptype: "subscriber",
							streams: subscription,
							use_msid: this.use_msid,
							private_id: this.mypvtid
						};
						this.remoteFeed.send({ message: subscribe });
					},
					error: (error) => {
						Janus.error("  -- Error attaching plugin...", error);
					},
					onmessage: (msg, jsep) => {
						Janus.debug(" ::: Got a message (subscriber) :::", msg);
						let event = msg["videoroom"];
						Janus.debug("Event: " + event);
						if (msg["error"]) {
							Janus.error("error: " + msg["error"]);
						} else if (event) {
							if (event === "attached") {
								// Now we have a working subscription, next requests will update this one
								this.creatingSubscription = false;
								Janus.log("Successfully attached to feed in room " + msg["room"]);
							} else if (event === "event") {
								// Check if we got an event on a simulcast-related event from this publisher
								let mid = msg["mid"];
								let substream = msg["substream"];
								let temporal = msg["temporal"];
								if ((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
									// Check which this feed this refers to
									let slot = this.slots[mid];
									if (!this.simulcastStarted[slot]) {
										this.simulcastStarted[slot] = true;
										// Add some new buttons
										//this.addSimulcastSvcButtons(slot, true);
									}
									// We just received notice that there's been a switch, update the buttons
									//this.updateSimulcastSvcButtons(slot, substream, temporal);
								}
								// Or maybe SVC?
								let spatial = msg["spatial_layer"];
								temporal = msg["temporal_layer"];
								if ((spatial !== null && spatial !== undefined) || (temporal !== null && temporal !== undefined)) {
									let slot = this.slots[mid];
									if (!this.svcStarted[slot]) {
										this.svcStarted[slot] = true;
										// Add some new buttons
										//this.addSimulcastSvcButtons(slot, true);
									}
									// We just received notice that there's been a switch, update the buttons
									//this.updateSimulcastSvcButtons(slot, spatial, temporal);
								}
							} else {
								// What has just happened?
							}
						}
						if (msg["streams"]) {
							// Update map of subscriptions by mid
							for (let i in msg["streams"]) {
								let mid = msg["streams"][i]["mid"];
								this.subStreams[mid] = msg["streams"][i];
								let feed = this.feedStreams[msg["streams"][i]["feed_id"]];
								if (feed && feed.slot) {
									this.slots[mid] = feed.slot;
									this.mids[feed.slot] = mid;
								}
							}
						}
						if (jsep) {
							Janus.debug("Handling SDP as well...", jsep);
							// Answer and attach
							this.remoteFeed.createAnswer(
								{
									jsep: jsep,
									// We only specify data channels here, as this way in
									// case they were offered we'll enable them. Since we
									// don't mention audio or video tracks, we autoaccept them
									// as recvonly (since we won't capture anything ourselves)
									tracks: [
										{ type: 'data' }
									],
									success: (jsep) => {
										Janus.debug("Got SDP!");
										Janus.debug(jsep);
										let body = { request: "start", room: this.room };
										this.remoteFeed.send({ message: body, jsep: jsep });
									},
									error: (error) => {
										Janus.error("WebRTC error:", error);
									}
								});
						}
					},
					// eslint-disable-next-line no-unused-vars
					onlocaltrack: (track, on) => {
						// The subscriber stream is recvonly, we don't expect anything here
					},
					onremotetrack: (track, mid, on, metadata) => {
						Janus.debug(
							"Remote track (mid=" + mid + ") " +
							(on ? "added" : "removed") +
							(metadata ? " (" + metadata.reason + ") " : "") + ":", track
						);
						// Which publisher are we getting on this mid?
						let sub = this.subStreams[mid];
						let feed = this.feedStreams[sub.feed_id];
						Janus.debug(" >> This track is coming from feed " + sub.feed_id + ":", feed);
						let slot = this.slots[mid];
						if (feed && !slot) {
							slot = feed.slot;
							this.slots[mid] = feed.slot;
							this.mids[feed.slot] = mid;
						}
						Janus.debug(" >> mid " + mid + " is in slot " + slot);
						if (!on) {
							// Track removed, get rid of the stream and the rendering
							if (track.kind === "video" && feed) {
								feed.remoteVideos--;
								if (feed.remoteVideos === 0) {
									// No video, at least for now: show a placeholder

								}
							}
							delete this.remoteTracks[mid];
							delete this.slots[mid];
							delete this.mids[slot];
							return;
						}


						// If we're here, a new track was added
						if (feed.spinner) {
							feed.spinner.stop();
							feed.spinner = null;
						}

						if (track.kind === "audio") {
							// New audio track: create a stream out of it, and use a hidden <audio> element
							let stream = new MediaStream([track]);
							this.remoteTracks[mid] = stream;
							Janus.log("Created remote audio stream:", stream);


							// const videoElement = this.$refs[`remotePublicher-${feed.id}`][0].querySelector('video');
							// videoElement.srcObject = stream;
							// const name = this.$refs[`remotePublicher-${feed.id}`][0].querySelector('div');
							// name.textContent = feed.display;


						// 	const videoElement = this.$refs.publicher2.querySelector('video');
						// videoElement.srcObject = stream;
						// const name = this.$refs.publicher2.querySelector('div');
						// name.textContent = feed.display;



							// 'remotePublicher-${publisher.id}'


							// const dynamicRefs = this.$refs.'remotePublicher-${publisher.id}';

							//Janus.attachMediaStream($('#remotevideo' + this.slot + '-' + this.mid).get(0), stream);
							if (feed.remoteVideos === 0) {
								// No video, at least for now: show a placeholder

							}
						} else {
							// New video track: create a stream out of it
							feed.remoteVideos++;

							//$('#videoremote' + slot + ' .no-video-container').remove();
							let stream = new MediaStream([track]);
							this.remoteTracks[mid] = stream;
							Janus.log("Created remote video stream:", stream);

							const videoElement1 = this.$refs[`remotePublicher-${feed.id}`][0].querySelector('video');
							videoElement1.srcObject = stream;
							const name1 = this.$refs[`remotePublicher-${feed.id}`][0].querySelector('div');
							name1.textContent = feed.display;

							

							//Janus.attachMediaStream($('#remotevideo' + slot + '-' + mid).get(0), stream);
							// Note: we'll need this for additional videos too


						}
					},
					oncleanup: () => {
						Janus.log(" ::: Got a cleanup notification (remote feed) :::");
						// for (let i = 1; i < 6; i++) {
						// 	$('#videoremote' + i).empty();
						// 	if (bitrateTimer[i])
						// 		clearInterval(bitrateTimer[i]);
						// 	bitrateTimer[i] = null;
						// 	feedStreams[i].simulcastStarted = false;
						// 	feedStreams[i].svcStarted = false;
						// 	feedStreams[i].remoteVideos = 0;
						// 	$('#simulcast' + i).remove();
						// }
						this.remoteTracks = {};
					}
				});
		},
		unsubscribeFrom(id) {
			// Unsubscribe from this publisher
			let feed = this.feedStreams[id];
			if (!feed)
				return;
			Janus.debug("Feed " + id + " (" + feed.display + ") has left the room, detaching");
			if (this.bitrateTimer[feed.slot])
				clearInterval(this.bitrateTimer[feed.slot]);
			this.bitrateTimer[feed.slot] = null;

			delete this.simulcastStarted[feed.slot];
			delete this.svcStarted[feed.slot];

			delete this.feeds[feed.slot];
			this.feeds.slot = 0;
			delete this.feedStreams[id];
			// Send an unsubscribe request
			let unsubscribe = {
				request: "unsubscribe",
				streams: [{ feed: id }]
			};
			if (this.remoteFeed != null)
				this.remoteFeed.send({ message: unsubscribe });

			const gridItem=this.$refs[`remotePublicher-${feed.id}`][0];
			gridItem.textContent="";

			delete this.subscriptions[id];
		},
		publishOwnFeed(useAudio) {
			let tracks = [];
			if (useAudio)
				tracks.push({ type: 'audio', capture: true, recv: false });
			tracks.push({
				type: 'video', capture: true, recv: false, simulcast: this.doSimulcast, svc: ((this.vcodec === 'vp9' || this.vcodec === 'av1') && this.doSvc) ? this.doSvc : null
			});

			this.sfutest.createOffer(
				{
					tracks: tracks,
					success: (jsep) => {
						Janus.debug("Got publisher SDP!");
						Janus.debug(jsep);
						let publish = { request: "configure", audio: useAudio, video: true };
						if (this.acodec)
							publish["audiocodec"] = this.acodec;
						if (this.vcodec)
							publish["videocodec"] = this.vcodec;
						this.sfutest.send({ message: publish, jsep: jsep });
					},
					error: (error) => {
						Janus.debug("WebRTC error:", error);
					}
				});
		}
	}

};
</script>
<style>
.grid-container {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	grid-gap: 10px;
}

.grid-item {
	position: relative;
	padding-bottom: 56.25%;
	/* 16:9 aspect ratio */
	overflow: hidden;
}

.grid-item video {
	position: relative;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
}

.participant-info {
	position: relative;
	top: 0;
	left: 0;
	padding: 10px;
	background-color: rgba(0, 0, 0, 0.7);
	color: white;
	font-weight: bold;
}

.mute-button {
	position: absolute;
	bottom: 10px;
	right: 10px;
	background-color: rgba(255, 255, 255, 0.7);
	padding: 5px;
	border-radius: 50%;
	cursor: pointer;
}

.mute-button:hover {
	background-color: rgba(255, 255, 255, 0.9);
}
</style>