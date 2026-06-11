CREATE TABLE "credentials" (
	"connection_id" text NOT NULL,
	"integration" text NOT NULL,
	"kind" text NOT NULL,
	"secret" text NOT NULL,
	"expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_connection_id_integration_pk" PRIMARY KEY("connection_id","integration")
);
