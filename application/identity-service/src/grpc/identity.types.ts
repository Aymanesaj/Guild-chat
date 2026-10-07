export interface ValidateTokenRequest {
  token: string;
}

export interface ValidateTokenResponse {
  valid: boolean;
  user_id: string;
  username: string;
  email: string;
}


export interface GetUserRequest {
  user_id: string;
}

export interface UserResponse {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
}


export interface AreFriendsRequest {
  user_a: string;
  user_b: string;
}

export interface AreFriendsResponse {
  are_friends: boolean;
}