export class Constants {
  private constructor() {}

  // Environment variable keys
  static readonly STEAM_WEB_API_KEY = 'STEAM_WEB_API_KEY';
  static readonly APP_ID_DEMO = 'APP_ID_DEMO';
  static readonly APP_ID_FULL = 'APP_ID_FULL';
  static readonly LEADERBOARD_NAME = 'LEADERBOARD_NAME';
  static readonly LEADERBOARD_TEST_ID = 'LEADERBOARD_TEST_ID';
  static readonly LEADERBOARD_DEMO_EASY_ID = 'LEADERBOARD_DEMO_EASY_ID';
  static readonly LEADERBOARD_DEMO_MEDIUM_ID = 'LEADERBOARD_DEMO_MEDIUM_ID';
  static readonly LEADERBOARD_DEMO_HARD_ID = 'LEADERBOARD_DEMO_HARD_ID';
  static readonly LEADERBOARD_DEMO_VERY_HARD_ID = 'LEADERBOARD_DEMO_VERY_HARD_ID';

  // Steam API constants
  static readonly STEAM_API_SCORE_METHOD_KEEP_BEST = 'KeepBest';
  static readonly STEAM_API_DATA_REQUEST_GLOBAL = 'RequestGlobal';
  static readonly STEAM_API_DATA_REQUEST_FRIENDS = 'RequestFriends';
  static readonly STEAM_API_DATA_REQUEST_AROUND_USER = 'RequestAroundUser';
}
