'use babel';

export default {
  accessKey: {
    description: 'Access API Key. You can create access/secret key pair at https://cloud.backend.ai .',
    type: 'string',
    default: '',
    order: 1
  },
  secretKey: {
    description: 'Secret API Key.',
    type: 'string',
    default: '',
    order: 2
  }
};
