const config = {
  locales: ['ro'],
  translations: {
    ro: {
      'app.components.LeftMenu.navbrand.title': 'WIB CMS',
      'app.components.LeftMenu.navbrand.workplace': 'asigurari.ro Blog',
      'Auth.form.welcome.title': 'Bine ai venit!',
      'Auth.form.welcome.subtitle': 'Conecteaza-te la panoul de administrare',
    },
  },
  tutorials: false,
  notifications: { releases: false },
};

const bootstrap = (app) => {
  console.log('WIB CMS Admin initialized');
};

export default {
  config,
  bootstrap,
};
