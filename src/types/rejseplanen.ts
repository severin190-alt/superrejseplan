export interface RejseplanErrorPayload {
  error: string;
  errorText?: string;
}

export interface StopPoint {
  name?: string;
  type?: string;
  id?: string;
  time?: string;
  date?: string;
  rtTime?: string;
  rtDate?: string;
}

export interface Note {
  value?: string;
  type?: string;
}

export interface Leg {
  Origin: StopPoint;
  Destination: StopPoint;
  JourneyDetailRef?: {
    ref?: string;
  };
  Notes?: {
    Note?: Note | Note[];
  };
  rtDepartureTime?: string;
  rtArrivalTime?: string;
  rtDate?: string;
}

export interface Trip {
  Leg?: Leg | Leg[];
}

export interface TripResponse {
  TripList?: {
    Trip?: Trip | Trip[];
  };
}

export interface HIMMessage {
  id?: string;
  header?: string;
  content?: string;
  rtPriority?: string;
  rtActualCalls?: string;
}

export interface HIMResponse {
  HIMMessageList?: {
    HIMMessage?: HIMMessage | HIMMessage[];
  };
}

export interface Departure {
  name?: string;
  type?: string;
  stop?: string;
  time?: string;
  date?: string;
  rtTime?: string;
  rtDate?: string;
  direction?: string;
  messages?: string;
}

export interface DepartureBoardResponse {
  DepartureBoard?: {
    Departure?: Departure | Departure[];
  };
}

export interface Location {
  id?: string;
  name?: string;
  type?: string;
  lon?: string;
  lat?: string;
  x?: string;
  y?: string;
}

export interface LocationResponse {
  LocationList?: {
    StopLocation?: Location | Location[];
    CoordLocation?: Location | Location[];
    Address?: Location | Location[];
  };
}

export interface JourneyDetailStop {
  name?: string;
  id?: string;
  arrTime?: string;
  arrDate?: string;
  depTime?: string;
  depDate?: string;
  rtArrTime?: string;
  rtArrDate?: string;
  rtDepTime?: string;
  rtDepDate?: string;
  lon?: string;
  lat?: string;
}

export interface JourneyDetailResponse {
  JourneyDetail?: {
    name?: string;
    type?: string;
    stop?: JourneyDetailStop | JourneyDetailStop[];
  };
}
