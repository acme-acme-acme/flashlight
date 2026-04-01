import React, { useRef, useCallback } from "react";

const TPN_PREFIX = "[FLASHLIGHT_TPN]";

type TPNStartPayload = {
  event: "nav_start";
  from: string;
  to: string;
  timestamp: number;
};

type TPNEndPayload = {
  event: "nav_end";
  to: string;
  timestamp: number;
};

type TPNPayload = TPNStartPayload | TPNEndPayload;

export const formatTPNEvent = (payload: TPNPayload): string =>
  `${TPN_PREFIX} ${JSON.stringify(payload)}`;

interface NavigationState {
  index: number;
  routes: {
    name: string;
    key: string;
    state?: NavigationState;
  }[];
}

export const getRouteName = (state: NavigationState | undefined): string | undefined => {
  if (!state) return undefined;
  const route = state.routes[state.index];
  if (route.state) return getRouteName(route.state);
  return route.name;
};

const emitTPN = (payload: TPNPayload): void => {
  console.log(formatTPNEvent(payload));
};

type NavigationContainerProps = {
  onStateChange?: (state: NavigationState | undefined) => void;
  [key: string]: unknown;
};

export const withNavigationTracker = <P extends NavigationContainerProps>(
  NavigationContainer: React.ComponentType<P>
): React.ComponentType<P> => {
  const TrackedContainer = React.forwardRef<unknown, P>(({ onStateChange, ...rest }, ref) => {
    const previousRouteRef = useRef<string | undefined>(undefined);

    const handleStateChange = useCallback(
      (state: NavigationState | undefined) => {
        const currentRoute = getRouteName(state);

        if (currentRoute && currentRoute !== previousRouteRef.current) {
          const from = previousRouteRef.current ?? "Initial";
          const timestamp = Date.now();

          emitTPN({ event: "nav_start", from, to: currentRoute, timestamp });

          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { InteractionManager } = require("react-native") as {
            InteractionManager: { runAfterInteractions: (fn: () => void) => void };
          };
          InteractionManager.runAfterInteractions(() => {
            requestAnimationFrame(() => {
              emitTPN({ event: "nav_end", to: currentRoute, timestamp: Date.now() });
            });
          });

          previousRouteRef.current = currentRoute;
        }

        if (typeof onStateChange === "function") {
          onStateChange(state);
        }
      },
      [onStateChange]
    );

    return React.createElement(NavigationContainer, {
      ...rest,
      ref,
      onStateChange: handleStateChange,
    } as unknown as P);
  });

  TrackedContainer.displayName = "NavigationTrackerContainer";
  return TrackedContainer as unknown as React.ComponentType<P>;
};
