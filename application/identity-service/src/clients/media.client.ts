
import "dotenv/config";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";

// --------------------------------------------------
// 1. Types matching the Media protobuf contract
// --------------------------------------------------

type MediaPurpose = "AVATAR";

export type UploadStatus =
  | "PENDING"
  | "PROCESSING"
  | "READY"
  | "FAILED"
  | "EXPIRED"
  | "DELETED"
  | "UPLOAD_STATUS_UNSPECIFIED";

export interface CreateUploadResponse {
  uploadId: string;
  uploadUrl: string;
  requiredContentType: string;
  expiresIn: number;
}

export interface FinalizeUploadResponse {
  mediaId: string;
  finalKey: string;
  contentType: string;
  width: number;
  height: number;
  status: UploadStatus;
}

export interface GetMediaStatusResponse {
  uploadId: string;
  status: UploadStatus;
  errorCode: string;
  deletionPending: boolean;
}

export interface GetDownloadUrlResponse {
  mediaId: string;
  downloadUrl: string;
  contentType: string;
  expiresIn: number;
}

export interface DeleteMediaResponse {
  mediaId: string;
  status: UploadStatus;
}

interface CreateUploadRequest {
  ownerId: string;
  purpose: MediaPurpose;
  contentType: string;
}

interface UploadRequest {
  uploadId: string;
  ownerId: string;
  purpose: MediaPurpose;
}

interface MediaRequest {
  mediaId: string;
  ownerId: string;
  purpose: MediaPurpose;
}

// --------------------------------------------------
// 2. Load protobuf
// --------------------------------------------------

const PROTO_PATH = path.resolve(
  process.cwd(),
  "proto/media.proto",
);

const packageDefinition = protoLoader.loadSync(
  PROTO_PATH,
  {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  },
);

const grpcPackage = grpc.loadPackageDefinition(
  packageDefinition,
) as unknown as {
  guild: {
    media: {
      v1: {
        MediaService: grpc.ServiceClientConstructor;
      };
    };
  };
};

const MediaService =
  grpcPackage.guild.media.v1.MediaService;

// --------------------------------------------------
// 3. Define the gRPC client methods
// --------------------------------------------------

type RpcCallback<T> = (
  error: grpc.ServiceError | null,
  response: T,
) => void;

interface MediaGrpcClient extends grpc.Client {
  createUpload(
    request: CreateUploadRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: RpcCallback<CreateUploadResponse>,
  ): grpc.ClientUnaryCall;

  finalizeUpload(
    request: UploadRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: RpcCallback<FinalizeUploadResponse>,
  ): grpc.ClientUnaryCall;

  getMediaStatus(
    request: UploadRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: RpcCallback<GetMediaStatusResponse>,
  ): grpc.ClientUnaryCall;

  getDownloadUrl(
    request: MediaRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: RpcCallback<GetDownloadUrlResponse>,
  ): grpc.ClientUnaryCall;

  deleteMedia(
    request: MediaRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: RpcCallback<DeleteMediaResponse>,
  ): grpc.ClientUnaryCall;
}

// --------------------------------------------------
// 4. Create the connection
// --------------------------------------------------

const address =
  process.env.MEDIA_GRPC_ADDRESS ??
  "127.0.0.1:50054";

const client = new MediaService(
  address,
  grpc.credentials.createInsecure(),
) as unknown as MediaGrpcClient;

// --------------------------------------------------
// 5. Authenticate Identity to Media
// --------------------------------------------------

function createMetadata(): grpc.Metadata {
  const token = process.env.MEDIA_IDENTITY_TOKEN;

  if (!token) {
    throw new Error(
      "MEDIA_IDENTITY_TOKEN is not configured",
    );
  }

  const metadata = new grpc.Metadata();

  metadata.set(
    "authorization",
    `Bearer ${token}`,
  );

  return metadata;
}

// --------------------------------------------------
// 6. Shared helper for unary RPC calls
// --------------------------------------------------

function callMedia<TRequest, TResponse>(
  method: (
    request: TRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: RpcCallback<TResponse>,
  ) => grpc.ClientUnaryCall,
  request: TRequest,
  timeoutMs = 5000,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const metadata = createMetadata();

    method.call(
      client,
      request,
      metadata,
      { deadline: Date.now() + timeoutMs },
      (error, response) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(response);
      },
    );
  });
}

// --------------------------------------------------
// 7. CreateUpload
// --------------------------------------------------

export function createAvatarUpload(
  ownerId: string,
  contentType: string,
): Promise<CreateUploadResponse> {
  return callMedia(
    client.createUpload,
    {
      ownerId,
      purpose: "AVATAR",
      contentType,
    },
  );
}

// --------------------------------------------------
// 8. FinalizeUpload
// --------------------------------------------------

export function finalizeAvatarUpload(
  uploadId: string,
  ownerId: string,
): Promise<FinalizeUploadResponse> {
  return callMedia(
    client.finalizeUpload,
    {
      uploadId,
      ownerId,
      purpose: "AVATAR",
    },
    30000,
  );
}

// --------------------------------------------------
// 9. GetMediaStatus
// --------------------------------------------------

export function getAvatarUploadStatus(
  uploadId: string,
  ownerId: string,
): Promise<GetMediaStatusResponse> {
  return callMedia(
    client.getMediaStatus,
    {
      uploadId,
      ownerId,
      purpose: "AVATAR",
    },
  );
}

// --------------------------------------------------
// 10. GetDownloadUrl
// --------------------------------------------------

export function getAvatarDownloadUrl(
  mediaId: string,
  ownerId: string,
): Promise<GetDownloadUrlResponse> {
  return callMedia(
    client.getDownloadUrl,
    {
      mediaId,
      ownerId,
      purpose: "AVATAR",
    },
  );
}

// --------------------------------------------------
// 11. DeleteMedia
// --------------------------------------------------

export function deleteAvatarMedia(
  mediaId: string,
  ownerId: string,
): Promise<DeleteMediaResponse> {
  return callMedia(
    client.deleteMedia,
    {
      mediaId,
      ownerId,
      purpose: "AVATAR",
    },
  );
}

// --------------------------------------------------
// 12. Graceful shutdown
// --------------------------------------------------

export function closeMediaClient(): void {
  client.close();
}
