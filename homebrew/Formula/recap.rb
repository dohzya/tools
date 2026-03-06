class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-darwin-arm64"
      sha256 "00ec77bf446f8524299af6e3f59f4fea6514468bab640b6e36bd88123f13f35c"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-darwin-x86_64"
      sha256 "2f879572ef30f2f9987e596280fd0559e1cfe53b33a3cacaf91b042915fab4ec"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-linux-arm64"
      sha256 "070d0577a5cbdf2f3752e2a4046399b62efa209d87b1ac92e6d1d999c8dff7bb"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-linux-x86_64"
      sha256 "51510bf208ba315a50eb1aa1ed2aa8db057c53038b7b29b722b47feecc153005"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "recap-darwin-arm64"
      else
        "recap-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "recap-linux-arm64"
      else
        "recap-linux-x86_64"
      end
    end

    bin.install binary_name => "recap"
  end

  test do
    system "#{bin}/recap", "--help"
  end
end
