module.exports = ({ env }) => ({
  'users-permissions': {
    config: {
      jwt: {
        expiresIn: '7d',
      },
      jwtSecret: env('JWT_SECRET'),
    },
  },
  upload: {
    config: {
      providerOptions: {
        localServer: {
          maxage: 300000, // 5 minutes browser cache for media
        },
      },
      sizeLimit: 10 * 1024 * 1024, // 10MB max upload
      breakpoints: {},
    },
  },
});
