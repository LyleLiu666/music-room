#include "engine/models/index_tts2/assets.h"
#include "engine/models/index_tts2/vocoder.h"
#include <algorithm>
#include <fstream>
#include <iostream>
#include <vector>
#include <string>
int main(int argc,char**argv){
 if(argc!=7){std::cerr<<"model mel frames pad backend output\n";return 2;}
 auto assets=engine::models::index_tts2::load_index_tts2_assets(argv[1]);
 const int64_t frames=std::stoll(argv[3]),pad=std::stoll(argv[4]),channels=80;
 std::vector<float> raw(channels*frames);std::ifstream(argv[2],std::ios::binary).read(reinterpret_cast<char*>(raw.data()),raw.size()*sizeof(float));
 std::vector<float> mel(channels*(frames+pad),-11.512925F);
 for(int64_t c=0;c<channels;++c)std::copy_n(raw.data()+c*frames,frames,mel.data()+c*(frames+pad));
 engine::core::BackendConfig backend;backend.type=std::string(argv[5])=="cpu"?engine::core::BackendType::Cpu:engine::core::BackendType::Metal;backend.threads=4;
 engine::models::index_tts2::IndexTTS2BigVganVocoder vocoder(assets,backend,engine::assets::TensorStorageType::Native);
 const auto audio=vocoder.synthesize(mel,frames+pad);
 std::ofstream(argv[6],std::ios::binary).write(reinterpret_cast<const char*>(audio.waveform.data()),audio.waveform.size()*sizeof(float));
 std::cout<<"samples="<<audio.waveform.size()<<" rate="<<audio.sample_rate<<"\n";
}
