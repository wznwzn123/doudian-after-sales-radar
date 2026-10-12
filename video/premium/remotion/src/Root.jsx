import React from "react";
import { Composition } from "remotion";
import { Film } from "./Film";
import plan from "./plan.json";

export const Root = () => <Composition id="film" component={Film} durationInFrames={plan.duration * plan.fps} fps={plan.fps} width={1080} height={1920} />;
