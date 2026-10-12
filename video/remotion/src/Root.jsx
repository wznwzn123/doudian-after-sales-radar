import React from "react";
import { Composition } from "remotion";
import { Promo } from "./Video";
import timeline from "./timeline.json";

const dur = (v) => Math.round(timeline.versions[v].scenes.at(-1).end * timeline.fps);
export const Root = () => (
  <>
    <Composition id="long" component={Promo} durationInFrames={dur("long")} fps={timeline.fps} width={1080} height={1920} defaultProps={{ version: "long", subs: true }} />
    <Composition id="short" component={Promo} durationInFrames={dur("short")} fps={timeline.fps} width={1080} height={1920} defaultProps={{ version: "short", subs: true }} />
  </>
);
